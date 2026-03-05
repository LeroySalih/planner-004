# Class Flashcard Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real-time class activity dashboard at `/flashcard-monitor/class/[groupId]` showing every pupil's flashcard sessions (in-progress or completed within 24h), updated live via SSE.

**Architecture:** New server action bootstraps pupils + recent sessions with attempt counts. SSE `flashcard.progress` events are enhanced to carry `correctCount`/`wrongCount` from client state. A client component subscribes to SSE and updates per-session mini-cards in real-time.

**Tech Stack:** Next.js 15 App Router, React 19, PostgreSQL via `pg`, SSE via existing hub, Tailwind CSS v4, Radix UI primitives.

---

## Task 1: Server action — `readClassFlashcardActivityAction`

**Files:**
- Modify: `src/lib/server-actions/flashcard-monitor.ts` (append new export)
- Modify: `src/lib/server-updates.ts` (add re-export)

**Step 1: Append the action to `flashcard-monitor.ts`**

Add this export at the bottom of `src/lib/server-actions/flashcard-monitor.ts`:

```typescript
export async function readClassFlashcardActivityAction(
  groupId: string,
  options?: TelemetryOptions,
) {
  const routeTag = options?.routeTag ?? "/flashcard-monitor:class"

  return withTelemetry(
    {
      routeTag,
      functionName: "readClassFlashcardActivityAction",
      params: { groupId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      await requireTeacherProfile()

      try {
        const membersResult = await query<{
          user_id: string
          first_name: string | null
          last_name: string | null
        }>(
          `SELECT gm.user_id, p.first_name, p.last_name
           FROM group_membership gm
           JOIN profiles p ON p.user_id = gm.user_id
           WHERE gm.group_id = $1
           ORDER BY p.last_name, p.first_name`,
          [groupId],
        )

        const pupils = membersResult.rows.map((r) => ({
          pupilId: r.user_id,
          firstName: r.first_name ?? "",
          lastName: r.last_name ?? "",
        }))

        const pupilIds = membersResult.rows.map((r) => r.user_id)
        let sessions: {
          sessionId: string
          pupilId: string
          activityId: string
          activityTitle: string
          status: "in_progress" | "completed"
          totalCards: number
          consecutiveCorrect: number
          correctCount: number
          wrongCount: number
          startedAt: string
          completedAt: string | null
        }[] = []

        if (pupilIds.length > 0) {
          const sessionsResult = await query<{
            session_id: string
            pupil_id: string
            activity_id: string
            activity_title: string
            status: string
            total_cards: number
            started_at: string
            completed_at: string | null
            correct_count: number
            wrong_count: number
          }>(
            `SELECT
               fs.session_id,
               fs.pupil_id,
               fs.activity_id,
               coalesce(a.title, 'Flashcards') as activity_title,
               fs.status,
               fs.total_cards::integer,
               fs.started_at,
               fs.completed_at,
               coalesce(SUM(fa.is_correct::int), 0)::integer as correct_count,
               (COUNT(fa.attempt_id) - coalesce(SUM(fa.is_correct::int), 0))::integer as wrong_count
             FROM flashcard_sessions fs
             JOIN activities a ON a.activity_id = fs.activity_id
             LEFT JOIN flashcard_attempts fa ON fa.session_id = fs.session_id
             WHERE fs.pupil_id = ANY($1::text[])
               AND (
                 fs.status = 'in_progress'
                 OR (fs.status = 'completed' AND fs.completed_at > now() - interval '24 hours')
               )
             GROUP BY
               fs.session_id, fs.pupil_id, fs.activity_id, a.title,
               fs.status, fs.total_cards, fs.started_at, fs.completed_at
             ORDER BY fs.started_at DESC`,
            [pupilIds],
          )

          sessions = sessionsResult.rows.map((r) => ({
            sessionId: r.session_id,
            pupilId: r.pupil_id,
            activityId: r.activity_id,
            activityTitle: r.activity_title,
            status: r.status as "in_progress" | "completed",
            totalCards: r.total_cards,
            // in_progress sessions: consecutiveCorrect unknown from DB, default 0
            // completed sessions: they achieved a clean pass so consecutiveCorrect = totalCards
            consecutiveCorrect: r.status === "completed" ? r.total_cards : 0,
            correctCount: r.correct_count,
            wrongCount: r.wrong_count,
            startedAt: r.started_at,
            completedAt: r.completed_at,
          }))
        }

        return { data: { pupils, sessions }, error: null }
      } catch (error) {
        console.error("[flashcard-monitor] Failed to load class activity", error)
        const message = error instanceof Error ? error.message : "Unable to load class activity."
        return { data: null, error: message }
      }
    },
  )
}
```

**Step 2: Re-export from `server-updates.ts`**

Find this block in `src/lib/server-updates.ts`:
```typescript
export {
  readFlashcardMonitorGroupsAction,
  readFlashcardSessionDetailAction,
  readLiveFlashcardMonitorAction,
  readStudyTrackerAction,
} from "./server-actions/flashcard-monitor";
```

Replace with:
```typescript
export {
  readClassFlashcardActivityAction,
  readFlashcardMonitorGroupsAction,
  readFlashcardSessionDetailAction,
  readLiveFlashcardMonitorAction,
  readStudyTrackerAction,
} from "./server-actions/flashcard-monitor";
```

**Step 3: Verify TypeScript compiles**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/flashcards-ui && pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to the new action.

**Step 4: Commit**

```bash
git add src/lib/server-actions/flashcard-monitor.ts src/lib/server-updates.ts
git commit -m "feat: add readClassFlashcardActivityAction for per-group pupil session bootstrap"
```

---

## Task 2: SSE enhancement — add `correctCount`/`wrongCount` to progress events

**Files:**
- Modify: `src/lib/server-actions/flashcards.ts` (extend `progress` param type + emit)
- Modify: `src/components/flashcards/flashcard-session.tsx` (track `totalAttempts`, pass counts)

### 2a: Extend `recordFlashcardAttemptAction`

In `src/lib/server-actions/flashcards.ts`, find the `progress?` type inside `recordFlashcardAttemptAction`'s input:

```typescript
progress?: {
  pupilId: string
  activityId: string
  consecutiveCorrect: number
  totalCards: number
}
```

Replace with:
```typescript
progress?: {
  pupilId: string
  activityId: string
  consecutiveCorrect: number
  totalCards: number
  correctCount?: number
  wrongCount?: number
}
```

Then find the `emitFlashcardEvent` call inside `recordFlashcardAttemptAction`:
```typescript
void emitFlashcardEvent("flashcard.progress", {
  pupilId, activityId, sessionId: input.sessionId,
  consecutiveCorrect, totalCards, status: "in_progress",
})
```

Replace with:
```typescript
void emitFlashcardEvent("flashcard.progress", {
  pupilId,
  activityId,
  sessionId: input.sessionId,
  consecutiveCorrect,
  totalCards,
  status: "in_progress",
  ...(input.progress.correctCount !== undefined && { correctCount: input.progress.correctCount }),
  ...(input.progress.wrongCount !== undefined && { wrongCount: input.progress.wrongCount }),
})
```

### 2b: Update `flashcard-session.tsx` to track and pass counts

In `src/components/flashcards/flashcard-session.tsx`:

**Add `totalAttempts` state** after the existing `totalCorrectAnswers` state declaration:
```typescript
const [totalAttempts, setTotalAttempts] = useState(0)
```

Also add it to the reset block inside `startSession` (find the block that resets state on restart):
```typescript
setTotalCorrectAnswers(0)
// add after:
setTotalAttempts(0)
```

**Update `handleSubmit`** to precompute counts before setting state and passing to SSE.

Find this block in `handleSubmit`:
```typescript
if (isCorrect) {
  setTotalCorrectAnswers((prev) => prev + 1)
}

// Fire-and-forget
if (sessionId) {
  const newConsecutiveForEmit = isCorrect ? consecutiveCorrect + 1 : 0
  recordFlashcardAttemptAction({
    sessionId,
    term: currentCard.template,
    definition: currentCard.answer,
    chosenDefinition: typedAnswer,
    isCorrect,
    attemptNumber: currentCount + 1,
    progress: {
      pupilId,
      activityId: deck.activityId,
      consecutiveCorrect: newConsecutiveForEmit,
      totalCards: pile.length,
    },
  })
}
```

Replace with:
```typescript
const newTotalAttempts = totalAttempts + 1
const newCorrectCount = totalCorrectAnswers + (isCorrect ? 1 : 0)
const newWrongCount = newTotalAttempts - newCorrectCount
const newConsecutiveForEmit = isCorrect ? consecutiveCorrect + 1 : 0

setTotalAttempts(newTotalAttempts)
if (isCorrect) {
  setTotalCorrectAnswers(newCorrectCount)
}

// Fire-and-forget
if (sessionId) {
  recordFlashcardAttemptAction({
    sessionId,
    term: currentCard.template,
    definition: currentCard.answer,
    chosenDefinition: typedAnswer,
    isCorrect,
    attemptNumber: currentCount + 1,
    progress: {
      pupilId,
      activityId: deck.activityId,
      consecutiveCorrect: newConsecutiveForEmit,
      totalCards: pile.length,
      correctCount: newCorrectCount,
      wrongCount: newWrongCount,
    },
  })
}
```

Also add `totalAttempts` to the `useCallback` dependency array for `handleSubmit`:
```typescript
[phase, pile, sessionId, consecutiveCorrect, attemptCounts, deck.activityId, totalCorrectAnswers, totalAttempts, pupilId],
```

**Step 3: TypeScript check**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/flashcards-ui && pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/lib/server-actions/flashcards.ts src/components/flashcards/flashcard-session.tsx
git commit -m "feat: emit correctCount and wrongCount in flashcard.progress SSE events"
```

---

## Task 3: New page and client component

**Files:**
- Create: `src/app/flashcard-monitor/class/[groupId]/page.tsx`
- Create: `src/app/flashcard-monitor/class/[groupId]/class-flashcard-monitor.tsx`

### 3a: Create `page.tsx`

```typescript
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readClassFlashcardActivityAction } from "@/lib/server-updates"
import { ClassFlashcardMonitor } from "./class-flashcard-monitor"

type PageProps = {
  params: Promise<{ groupId: string }>
}

export default async function ClassFlashcardMonitorPage({ params }: PageProps) {
  const { groupId } = await params
  const result = await readClassFlashcardActivityAction(groupId)

  if (result.error || !result.data) {
    return (
      <TeacherPageLayout
        breadcrumbs={[
          { label: "Flashcard Monitor", href: "/flashcard-monitor" },
          { label: groupId },
          { label: "Class Activity" },
        ]}
        title="Class Activity"
      >
        <p className="text-destructive">{result.error ?? "Failed to load data."}</p>
      </TeacherPageLayout>
    )
  }

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "Flashcard Monitor", href: "/flashcard-monitor" },
        { label: groupId },
        { label: "Class Activity" },
      ]}
      title="Class Activity"
      subtitle={`${groupId} — Live pupil flashcard activity`}
    >
      <ClassFlashcardMonitor
        initialPupils={result.data.pupils}
        initialSessions={result.data.sessions}
      />
    </TeacherPageLayout>
  )
}
```

### 3b: Create `class-flashcard-monitor.tsx`

```typescript
"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type Pupil = {
  pupilId: string
  firstName: string
  lastName: string
}

type SessionStats = {
  sessionId: string
  pupilId: string
  activityId: string
  activityTitle: string
  status: "in_progress" | "completed"
  totalCards: number
  consecutiveCorrect: number
  correctCount: number
  wrongCount: number
  startedAt: string
  completedAt: string | null
}

type SsePayload = {
  pupilId?: string
  activityId?: string
  sessionId?: string
  consecutiveCorrect?: number
  totalCards?: number
  status?: string
  correctCount?: number
  wrongCount?: number
}

type Props = {
  initialPupils: Pupil[]
  initialSessions: SessionStats[]
}

export function ClassFlashcardMonitor({ initialPupils, initialSessions }: Props) {
  const [sessionMap, setSessionMap] = useState<Map<string, SessionStats>>(() => {
    const map = new Map<string, SessionStats>()
    for (const s of initialSessions) {
      map.set(s.sessionId, s)
    }
    return map
  })
  const [connected, setConnected] = useState(false)

  const pupilIdSet = useMemo(
    () => new Set(initialPupils.map((p) => p.pupilId)),
    [initialPupils],
  )

  useEffect(() => {
    const eventSource = new EventSource("/sse?topics=flashcards")
    eventSource.onopen = () => setConnected(true)
    eventSource.onerror = () => setConnected(false)

    eventSource.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as {
          topic?: string
          type?: string
          payload?: SsePayload
        }
        if (envelope.topic !== "flashcards") return

        const payload = envelope.payload
        if (!payload?.pupilId || !payload?.sessionId) return
        if (!pupilIdSet.has(payload.pupilId)) return

        const { pupilId, activityId, sessionId, consecutiveCorrect, totalCards, correctCount, wrongCount } = payload

        setSessionMap((prev) => {
          const next = new Map(prev)

          if (envelope.type === "flashcard.start") {
            next.set(sessionId!, {
              sessionId: sessionId!,
              pupilId: pupilId!,
              activityId: activityId ?? "",
              activityTitle: "Flashcards",
              status: "in_progress",
              totalCards: totalCards ?? 0,
              consecutiveCorrect: 0,
              correctCount: 0,
              wrongCount: 0,
              startedAt: new Date().toISOString(),
              completedAt: null,
            })
          } else if (envelope.type === "flashcard.progress") {
            const existing = next.get(sessionId!)
            if (existing) {
              next.set(sessionId!, {
                ...existing,
                consecutiveCorrect:
                  typeof consecutiveCorrect === "number"
                    ? consecutiveCorrect
                    : existing.consecutiveCorrect,
                totalCards:
                  typeof totalCards === "number" ? totalCards : existing.totalCards,
                correctCount:
                  typeof correctCount === "number" ? correctCount : existing.correctCount,
                wrongCount:
                  typeof wrongCount === "number" ? wrongCount : existing.wrongCount,
              })
            }
          } else if (envelope.type === "flashcard.complete") {
            const existing = next.get(sessionId!)
            if (existing) {
              next.set(sessionId!, {
                ...existing,
                status: "completed",
                consecutiveCorrect: totalCards ?? existing.totalCards,
                completedAt: new Date().toISOString(),
              })
            }
          }

          return next
        })
      } catch {
        // ignore malformed events
      }
    }

    return () => eventSource.close()
  }, [pupilIdSet])

  const sessions = useMemo(() => Array.from(sessionMap.values()), [sessionMap])

  const sessionsByPupil = useMemo(() => {
    const map = new Map<string, SessionStats[]>()
    for (const s of sessions) {
      const arr = map.get(s.pupilId) ?? []
      arr.push(s)
      map.set(s.pupilId, arr)
    }
    return map
  }, [sessions])

  const sortedPupils = useMemo(
    () =>
      [...initialPupils].sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      ),
    [initialPupils],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Badge variant={connected ? "secondary" : "outline"}>
          {connected ? "Live" : "Reconnecting..."}
        </Badge>
      </div>

      <div className="flex flex-col gap-3">
        {sortedPupils.map((pupil) => {
          const pupilSessions = sessionsByPupil.get(pupil.pupilId) ?? []
          return (
            <PupilRow key={pupil.pupilId} pupil={pupil} sessions={pupilSessions} />
          )
        })}
      </div>
    </div>
  )
}

function PupilRow({ pupil, sessions }: { pupil: Pupil; sessions: SessionStats[] }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 font-medium">
        {pupil.firstName} {pupil.lastName}
      </h3>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent activity</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {sessions.map((s) => (
            <SessionCard key={s.sessionId} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionCard({ session }: { session: SessionStats }) {
  const progressPercent =
    session.totalCards > 0
      ? Math.round((session.consecutiveCorrect / session.totalCards) * 100)
      : 0

  const isComplete = session.status === "completed"

  return (
    <div
      className={cn(
        "flex w-48 flex-col gap-2 rounded-md border p-3",
        isComplete &&
          "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{session.activityTitle}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-xs",
            isComplete
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
          )}
        >
          {isComplete ? "✓" : "●"}
        </span>
      </div>

      <div className="flex gap-3 text-sm">
        <span className="text-emerald-700 dark:text-emerald-400">✓ {session.correctCount}</span>
        <span className="text-red-700 dark:text-red-400">✗ {session.wrongCount}</span>
      </div>

      <Progress value={progressPercent} className="h-1.5" />
      <span className="text-xs text-muted-foreground">
        {isComplete
          ? "Complete"
          : `${session.consecutiveCorrect}/${session.totalCards} in a row`}
      </span>
    </div>
  )
}
```

**Step 3: TypeScript check**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/flashcards-ui && pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/app/flashcard-monitor/class/
git commit -m "feat: add class flashcard monitor page with real-time SSE updates"
```

---

## Task 4: Navigation — add Class Activity to monitor selector

**Files:**
- Modify: `src/app/flashcard-monitor/flashcard-monitor-selector.tsx`

Find the closing `</div>` of the two-column grid (after the Study Tracker column closes). The grid currently has two children; add a third:

```tsx
{/* Class Activity */}
<div>
  <h2 className="mb-3 text-lg font-semibold">Class Activity</h2>
  <p className="mb-4 text-sm text-muted-foreground">
    See all pupils&apos; current flashcard activity in real-time.
  </p>
  <Link
    href={`/flashcard-monitor/class/${encodeURIComponent(selectedGroupId)}`}
    className="block rounded-md border p-3 text-sm hover:bg-accent transition-colors"
  >
    View class activity →
  </Link>
</div>
```

The grid div currently reads `<div className="grid gap-8 md:grid-cols-2">`. Update it to three columns:

```tsx
<div className="grid gap-8 md:grid-cols-3">
```

**Step 2: TypeScript check**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/flashcards-ui && pnpm exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

**Step 3: Lint**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/flashcards-ui && pnpm lint 2>&1 | tail -20
```

Expected: no new errors.

**Step 4: Commit**

```bash
git add src/app/flashcard-monitor/flashcard-monitor-selector.tsx
git commit -m "feat: add Class Activity link to flashcard monitor selector"
```

---

## Manual Testing Checklist

1. Navigate to `/flashcard-monitor` — group selector shows "Class Activity" column with a link
2. Click "View class activity →" for a group — lands on `/flashcard-monitor/class/[groupId]`
3. Pupils with no recent activity show "No recent activity"
4. Pupils with in-progress or recently-completed sessions show session mini-cards
5. Open `/flashcards` as a pupil in a second tab, start a flashcard session
6. The class monitor updates in real-time: new mini-card appears for that pupil
7. Answer cards — ✓ and ✗ counts update live
8. Complete the session — card shows "Complete" with green styling
9. Reload the class monitor after 25+ hours — completed sessions from yesterday disappear
10. "Live" badge shows when SSE is connected; "Reconnecting..." when connection drops
