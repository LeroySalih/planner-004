# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the teacher dashboard to a 2×2 quad-grid with compact card-style items, a new "Recent Submissions" panel, and flagged submissions grouped by pupil.

**Architecture:** Four equal quadrants (CSS grid 1fr 1fr × 2 rows), each independently scrollable. Existing server-component panels get card-grid rendering. A new client-component `RecentSubmissionsPanel` fetches fresh data on time-filter change via `useTransition`. Flagged grouping happens client-side in the component before render.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, PostgreSQL via `pg`, Zod, server actions returning `{ data, error }`.

**Working directory:** `.worktrees/update-dashboard`
**Dev server:** `http://localhost:3001`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/server-actions/dashboard.ts` | Modify | Add `readRecentSubmissionsAction` with Zod schemas |
| `src/lib/server-updates.ts` | Modify | Re-export new action and type |
| `src/components/teacher-dashboard/recent-submissions-panel.tsx` | Create | Client component: time filter + card grid |
| `src/components/teacher-dashboard/flagged-panel.tsx` | Modify | Group by pupil, top 5, card grid |
| `src/components/teacher-dashboard/marking-queue-panel.tsx` | Modify | Card grid instead of rows |
| `src/components/teacher-dashboard/mentions-panel.tsx` | Modify | Card grid instead of rows |
| `src/app/page.tsx` | Modify | 2×2 grid layout + add RecentSubmissionsPanel |

---

## Task 1: Add `readRecentSubmissionsAction` server action

**Files:**
- Modify: `src/lib/server-actions/dashboard.ts`

- [ ] **Step 1: Add the action to `dashboard.ts`**

Append after the existing `readMentionsAction` block (before the `markAllUnmarkedForLessonAction` block):

```typescript
// ── Recent Submissions ────────────────────────────────────────────────────────

const RecentSubmissionsInputSchema = z.object({
  hours: z.union([z.literal(1), z.literal(24), z.literal(48), z.literal(72)]),
})

const RecentSubmissionsItemSchema = z.object({
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  submissionCount: z.number(),
})

const RecentSubmissionsResultSchema = z.object({
  data: RecentSubmissionsItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type RecentSubmissionsItem = z.infer<typeof RecentSubmissionsItemSchema>

export async function readRecentSubmissionsAction(hours: 1 | 24 | 48 | 72) {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  return withTelemetry(
    { routeTag: "dashboard", functionName: "readRecentSubmissionsAction", params: { hours }, authEndTime },
    async () => {
      try {
        const { hours: validHours } = RecentSubmissionsInputSchema.parse({ hours })

        const { rows } = await query<{
          lesson_id: string
          lesson_title: string
          group_id: string
          group_name: string
          submission_count: number
        }>(
          `
            SELECT
              l.lesson_id,
              l.title                                 AS lesson_title,
              g.group_id,
              g.subject                               AS group_name,
              COUNT(DISTINCT s.submission_id)::int    AS submission_count
            FROM submissions         s
            JOIN activities          a   ON a.activity_id  = s.activity_id
            JOIN lessons             l   ON l.lesson_id    = a.lesson_id
            JOIN lesson_assignments  la  ON la.lesson_id   = l.lesson_id
            JOIN groups              g   ON g.group_id     = la.group_id
            JOIN group_membership    gm  ON gm.group_id    = g.group_id
                                        AND gm.user_id     = s.user_id
            WHERE s.submitted_at >= NOW() - ($1 * interval '1 hour')
            GROUP BY l.lesson_id, l.title, g.group_id, g.subject
            ORDER BY submission_count DESC
          `,
          [validHours],
        )

        const data = (rows ?? []).map((row) => ({
          lessonId: row.lesson_id,
          lessonTitle: row.lesson_title,
          groupId: row.group_id,
          groupName: row.group_name,
          submissionCount: row.submission_count,
        }))

        return RecentSubmissionsResultSchema.parse({ data, error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load recent submissions."
        console.error("[dashboard] readRecentSubmissionsAction failed", error)
        return RecentSubmissionsResultSchema.parse({ data: null, error: message })
      }
    },
  )
}
```

- [ ] **Step 2: Re-export from `src/lib/server-updates.ts`**

Find the existing dashboard export block (around line 321):
```typescript
export {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  markAllUnmarkedForLessonAction,
  type MarkingQueueItem,
  type FlaggedItem,
  type MentionItem,
} from "./server-actions/dashboard"
```

Replace with:
```typescript
export {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  readRecentSubmissionsAction,
  markAllUnmarkedForLessonAction,
  type MarkingQueueItem,
  type FlaggedItem,
  type MentionItem,
  type RecentSubmissionsItem,
} from "./server-actions/dashboard"
```

- [ ] **Step 3: Verify TypeScript compiles**

Run from `.worktrees/update-dashboard`:
```bash
pnpm build 2>&1 | head -40
```
Expected: no TypeScript errors related to the new action.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/dashboard.ts src/lib/server-updates.ts
git commit -m "feat: add readRecentSubmissionsAction for dashboard recent submissions panel"
```

---

## Task 2: Create `RecentSubmissionsPanel` client component

**Files:**
- Create: `src/components/teacher-dashboard/recent-submissions-panel.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client"

import { useState, useEffect, useTransition } from "react"
import Link from "next/link"
import { readRecentSubmissionsAction, type RecentSubmissionsItem } from "@/lib/server-updates"

const HOURS_OPTIONS = [1, 24, 48, 72] as const
type Hours = typeof HOURS_OPTIONS[number]

export function RecentSubmissionsPanel() {
  const [hours, setHours] = useState<Hours>(24)
  const [items, setItems] = useState<RecentSubmissionsItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const result = await readRecentSubmissionsAction(hours)
      if (result.error) {
        setError(result.error)
        setItems([])
      } else {
        setError(null)
        setItems(result.data ?? [])
      }
    })
  }, [hours])

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-green-400">Recent Submissions</span>
        <span className="rounded-full bg-green-400/10 px-2 py-0.5 text-xs font-bold text-green-400">
          {items.length}
        </span>
      </div>

      <div className="flex gap-1">
        {HOURS_OPTIONS.map((h) => (
          <button
            key={h}
            onClick={() => setHours(h)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              hours === h
                ? "border-green-400 bg-green-400/10 text-green-400"
                : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
            }`}
          >
            {h}h
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : items.length === 0 && !isPending ? (
        <p className="text-xs text-slate-500">No submissions in the last {hours}h.</p>
      ) : (
        <div className={`flex flex-wrap gap-1.5 ${isPending ? "opacity-60" : ""}`}>
          {items.map((item) => (
            <Link
              key={`${item.lessonId}-${item.groupId}`}
              href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
              className="flex flex-col rounded-md border border-green-900 bg-green-950/40 px-2.5 py-2 hover:border-green-700"
            >
              <span className="text-xs font-semibold text-green-300">{item.lessonTitle}</span>
              <span className="text-xs text-slate-500">{item.groupName}</span>
              <span className="mt-1 self-start rounded-full bg-green-400/10 px-1.5 py-0.5 text-xs font-bold text-green-400">
                {item.submissionCount} sub{item.submissionCount !== 1 ? "s" : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm build 2>&1 | grep -E "error|Error" | head -20
```
Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-dashboard/recent-submissions-panel.tsx
git commit -m "feat: add RecentSubmissionsPanel client component with time filter"
```

---

## Task 3: Update `FlaggedPanel` — group by pupil, card grid

**Files:**
- Modify: `src/components/teacher-dashboard/flagged-panel.tsx`

- [ ] **Step 1: Replace the file content**

```typescript
import Link from "next/link"
import { readFlaggedSubmissionsAction } from "@/lib/server-updates"

export async function FlaggedPanel() {
  const { data: items, error } = await readFlaggedSubmissionsAction()

  const flagged = items ?? []

  // Group by pupil name, accumulate flag count and lesson links
  const byPupil = new Map<string, { pupilName: string; groupId: string; groupName: string; lessonId: string; count: number }>()
  for (const item of flagged) {
    const existing = byPupil.get(item.pupilName)
    if (existing) {
      existing.count += 1
    } else {
      byPupil.set(item.pupilName, {
        pupilName: item.pupilName,
        groupId: item.groupId,
        groupName: item.groupName,
        lessonId: item.lessonId,
        count: 1,
      })
    }
  }

  const top5 = Array.from(byPupil.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-red-400">Flagged</span>
        <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-bold text-red-400">
          {flagged.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : top5.length === 0 ? (
        <p className="text-xs text-slate-500">No flagged submissions.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {top5.map((pupil) => (
            <Link
              key={pupil.pupilName}
              href={`/feedback/groups/${encodeURIComponent(pupil.groupId)}/lessons/${encodeURIComponent(pupil.lessonId)}`}
              className="flex flex-col rounded-md border border-red-900 bg-red-950/40 px-2.5 py-2 hover:border-red-700"
            >
              <span className="text-xs font-semibold text-red-300">{pupil.pupilName}</span>
              <span className="text-xs text-slate-500">{pupil.groupName}</span>
              <span className="mt-1 self-start rounded-full bg-red-400/10 px-1.5 py-0.5 text-xs font-bold text-red-400">
                {pupil.count} flag{pupil.count !== 1 ? "s" : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-dashboard/flagged-panel.tsx
git commit -m "feat: group flagged submissions by pupil (top 5) with card layout"
```

---

## Task 4: Update `MarkingQueuePanel` — card grid

**Files:**
- Modify: `src/components/teacher-dashboard/marking-queue-panel.tsx`

- [ ] **Step 1: Replace the file content**

```typescript
import Link from "next/link"
import { MarkAllButton } from "@/components/teacher-dashboard/mark-all-button"
import { readMarkingQueueAction } from "@/lib/server-updates"

export async function MarkingQueuePanel() {
  const { data: items, error } = await readMarkingQueueAction()

  const queue = items ?? []
  const totalSubmissions = queue.reduce((sum, item) => sum + item.submissionCount, 0)

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-amber-400">Needs Review</span>
        <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-400">
          {totalSubmissions}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : queue.length === 0 ? (
        <p className="text-xs text-slate-500">No lessons awaiting review.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {queue.map((item) => (
            <div
              key={`${item.lessonId}-${item.groupId}`}
              className="flex flex-col rounded-md border border-amber-900 bg-amber-950/40 px-2.5 py-2"
            >
              <Link
                href={`/results/assignments/${encodeURIComponent(`${item.groupId}__${item.lessonId}`)}`}
                className="text-xs font-semibold text-amber-300 hover:underline"
              >
                {item.lessonTitle} ↗
              </Link>
              <span className="text-xs text-slate-500">{item.groupName}</span>
              <span className="mt-1 self-start rounded-full bg-amber-400/10 px-1.5 py-0.5 text-xs font-bold text-amber-400">
                {item.submissionCount} activit{item.submissionCount !== 1 ? "ies" : "y"}
              </span>
              <div className="mt-1">
                <MarkAllButton groupId={item.groupId} lessonId={item.lessonId} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-dashboard/marking-queue-panel.tsx
git commit -m "feat: render marking queue as card grid"
```

---

## Task 5: Update `MentionsPanel` — card grid

**Files:**
- Modify: `src/components/teacher-dashboard/mentions-panel.tsx`

- [ ] **Step 1: Replace the file content**

```typescript
import Link from "next/link"
import { readMentionsAction } from "@/lib/server-updates"

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export async function MentionsPanel() {
  const { data: items, error } = await readMentionsAction()

  const mentions = items ?? []

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-blue-400">Mentions</span>
        <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-xs font-bold text-blue-400">
          {mentions.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : mentions.length === 0 ? (
        <p className="text-xs text-slate-500">No pupil mentions.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {mentions.map((item) => (
            <Link
              key={item.commentId}
              href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
              className="flex flex-col rounded-md border border-blue-900 bg-blue-950/40 px-2.5 py-2 hover:border-blue-700"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-semibold text-blue-300">{item.pupilName}</span>
                <span className="text-xs text-slate-500">{timeAgo(item.createdAt)}</span>
              </div>
              <p className="mt-1 max-w-[160px] truncate text-xs italic text-slate-400">
                &ldquo;{item.comment}&rdquo;
              </p>
              <span className="text-xs text-slate-500">{item.groupName}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-dashboard/mentions-panel.tsx
git commit -m "feat: render mentions as card grid"
```

---

## Task 6: Restructure `page.tsx` — 2×2 grid layout

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace the page content**

```typescript
export const dynamic = "force-dynamic"

import Link from "next/link"
import { Suspense } from "react"
import { requireTeacherProfile } from "@/lib/auth"
import { readMarkingQueueAction, readFlaggedSubmissionsAction, readMentionsAction } from "@/lib/server-updates"
import { RecentSubmissionsPanel } from "@/components/teacher-dashboard/recent-submissions-panel"
import { MarkingQueuePanel } from "@/components/teacher-dashboard/marking-queue-panel"
import { FlaggedPanel } from "@/components/teacher-dashboard/flagged-panel"
import { MentionsPanel } from "@/components/teacher-dashboard/mentions-panel"
import { DashboardClient } from "@/components/teacher-dashboard/dashboard-client"

export default async function TeacherDashboardPage() {
  const profile = await requireTeacherProfile()

  const [markingResult, flaggedResult, mentionsResult] = await Promise.all([
    readMarkingQueueAction(),
    readFlaggedSubmissionsAction(),
    readMentionsAction(),
  ])

  const initialMarkingCount = (markingResult.data ?? []).reduce((s, i) => s + i.submissionCount, 0)
  const initialFlaggedCount = (flaggedResult.data ?? []).length
  const initialMentionsCount = (mentionsResult.data ?? []).length

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email || "Teacher"

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-100">{displayName}</span>
          <span className="text-xs text-slate-500">Teacher Dashboard</span>
        </div>
        <Link
          href="/assignments"
          className="rounded bg-slate-800 px-3 py-1.5 text-xs text-blue-300 hover:bg-slate-700"
        >
          Assignments →
        </Link>
      </div>

      <DashboardClient
        initialMarkingCount={initialMarkingCount}
        initialFlaggedCount={initialFlaggedCount}
        initialMentionsCount={initialMentionsCount}
      >
        {/* 2×2 quad grid */}
        <div className="grid min-h-[calc(100vh-88px)] grid-cols-2 grid-rows-2">
          {/* Top-left: Recent Submissions (client component, no Suspense needed for skeleton — renders empty state) */}
          <div className="max-h-[50vh] overflow-y-auto border-b border-r border-slate-800">
            <RecentSubmissionsPanel />
          </div>

          {/* Top-right: Needs Review */}
          <div className="max-h-[50vh] overflow-y-auto border-b border-slate-800">
            <Suspense fallback={<PanelSkeleton />}>
              <MarkingQueuePanel />
            </Suspense>
          </div>

          {/* Bottom-left: Flagged by Pupil */}
          <div className="max-h-[50vh] overflow-y-auto border-r border-slate-800">
            <Suspense fallback={<PanelSkeleton />}>
              <FlaggedPanel />
            </Suspense>
          </div>

          {/* Bottom-right: Mentions */}
          <div className="max-h-[50vh] overflow-y-auto">
            <Suspense fallback={<PanelSkeleton />}>
              <MentionsPanel />
            </Suspense>
          </div>
        </div>
      </DashboardClient>
    </main>
  )
}

function PanelSkeleton() {
  return (
    <div className="animate-pulse p-4">
      <div className="mb-3 h-3 w-24 rounded bg-slate-800" />
      <div className="flex flex-wrap gap-1.5">
        <div className="h-16 w-28 rounded bg-slate-800" />
        <div className="h-16 w-28 rounded bg-slate-800" />
        <div className="h-16 w-28 rounded bg-slate-800" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build and check for errors**

```bash
pnpm build 2>&1 | grep -E "error TS|Error:" | head -20
```
Expected: no TypeScript errors.

- [ ] **Step 3: Manual smoke test**

Open `http://localhost:3001` in a browser. Verify:
- 2×2 quad grid renders
- Recent Submissions appears top-left with time filter buttons
- Clicking 1h / 48h / 72h updates the cards
- Needs Review appears top-right
- Flagged by Pupil appears bottom-left grouped by pupil name
- Mentions appear bottom-right
- Each panel scrolls independently if cards overflow

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: restructure teacher dashboard to 2x2 quad grid with card layouts"
```

---

## Done

All tasks complete. The dashboard now has:
- 2×2 quad grid layout
- Compact card-style items that wrap across each panel
- New Recent Submissions panel (top-left) with 1h/24h/48h/72h filter
- Flagged panel (bottom-left) grouped by pupil, top 5 by flag count
- Marking queue and Mentions converted to card grids
