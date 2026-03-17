# Teacher Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the root `/` page with a live teacher dashboard showing lessons needing AI-marking review, flagged submissions, and pupil mentions.

**Architecture:** Server components fetch initial panel data in parallel; a client component (`DashboardClient`) subscribes to the existing SSE hub and updates badge counts in real time without re-rendering panels. A new `submission_comments` table backs the mentions panel; pupils add comments via a new input on the submission view.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, PostgreSQL (`pg`), Zod, Tailwind CSS v4, existing SSE hub (`/sse`), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-03-17-teacher-dashboard-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/migrations/068_add_submission_comments.sql` | New table for pupil comments |
| Create | `src/lib/server-actions/dashboard.ts` | Three read actions for panels |
| Create | `src/lib/server-actions/submission-comments.ts` | Write action for pupil comments |
| Modify | `src/lib/server-updates.ts` | Re-export new actions |
| Create | `src/components/teacher-dashboard/marking-queue-panel.tsx` | Server component — needs-review list |
| Create | `src/components/teacher-dashboard/flagged-panel.tsx` | Server component — flagged submissions |
| Create | `src/components/teacher-dashboard/mentions-panel.tsx` | Server component — pupil mentions |
| Create | `src/components/teacher-dashboard/dashboard-client.tsx` | Client component — SSE badge updates |
| Replace | `src/app/page.tsx` | Teacher dashboard page (replaces dev status page) |
| Create | `src/components/submission-comment-input.tsx` | Client component — pupil comment textarea |
| Modify | `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx` | Add comment input to submission view |
| Create | `tests/dashboard/teacher-dashboard.spec.ts` | Playwright E2E tests |

---

## Chunk 1: Migration and Server Actions

### Task 1: Database migration — `submission_comments` table

**Files:**
- Create: `src/migrations/068_add_submission_comments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 068: Add submission_comments table for pupil-to-teacher mentions
CREATE TABLE IF NOT EXISTS public.submission_comments (
  id            text        NOT NULL DEFAULT gen_random_uuid(),
  submission_id text        NOT NULL REFERENCES submissions(submission_id),
  user_id       text        NOT NULL REFERENCES profiles(user_id),
  comment       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_comments_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_sc_submission ON public.submission_comments (submission_id);
CREATE INDEX IF NOT EXISTS idx_sc_user       ON public.submission_comments (user_id);
```

- [ ] **Step 2: Apply the migration**

```bash
psql $DATABASE_URL -f src/migrations/068_add_submission_comments.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX` — no errors.

- [ ] **Step 3: Verify the table exists**

```bash
psql $DATABASE_URL -c "\d submission_comments"
```

Expected: table with columns `id`, `submission_id`, `user_id`, `comment`, `created_at` and two indexes.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/068_add_submission_comments.sql
git commit -m "feat: add submission_comments migration for pupil mentions"
```

---

### Task 2: Dashboard server actions

**Files:**
- Create: `src/lib/server-actions/dashboard.ts`

- [ ] **Step 1: Write the server actions file**

```typescript
"use server"

import { z } from "zod"
import { query } from "@/lib/db"
import { requireTeacherProfile } from "@/lib/auth"

// ── Marking Queue ────────────────────────────────────────────────────────────

const MarkingQueueItemSchema = z.object({
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  unitTitle: z.string(),
  submissionCount: z.number(),
})

const MarkingQueueResultSchema = z.object({
  data: MarkingQueueItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type MarkingQueueItem = z.infer<typeof MarkingQueueItemSchema>

export async function readMarkingQueueAction() {
  await requireTeacherProfile()

  try {
    const { rows } = await query<{
      lesson_id: string
      lesson_title: string
      group_id: string
      group_name: string
      unit_title: string
      submission_count: string
    }>(
      `
        SELECT
          l.lesson_id,
          l.title                       AS lesson_title,
          g.group_id,
          g.name                        AS group_name,
          u.title                       AS unit_title,
          COUNT(s.submission_id)::text  AS submission_count
        FROM submissions s
        JOIN activities          a  ON a.activity_id  = s.activity_id
        JOIN lessons             l  ON l.lesson_id    = a.lesson_id
        JOIN lesson_assignments  la ON la.lesson_id   = l.lesson_id
        JOIN groups              g  ON g.group_id     = la.group_id
        JOIN units               u  ON u.unit_id      = l.unit_id
        WHERE a.type = 'short-text-question'
          AND (s.body->>'ai_model_score')       IS NOT NULL
          AND (s.body->>'teacher_override_score') IS NULL
        GROUP BY l.lesson_id, l.title, g.group_id, g.name, u.title
        ORDER BY COUNT(s.submission_id) DESC
      `,
    )

    const data = (rows ?? []).map((row) => ({
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title,
      groupId: row.group_id,
      groupName: row.group_name,
      unitTitle: row.unit_title,
      submissionCount: Number(row.submission_count),
    }))

    return MarkingQueueResultSchema.parse({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load marking queue."
    console.error("[dashboard] readMarkingQueueAction failed", error)
    return MarkingQueueResultSchema.parse({ data: null, error: message })
  }
}

// ── Flagged Submissions ──────────────────────────────────────────────────────

const FlaggedItemSchema = z.object({
  submissionId: z.string(),
  pupilName: z.string(),
  activityTitle: z.string(),
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  submittedAt: z.string().nullable(),
})

const FlaggedResultSchema = z.object({
  data: FlaggedItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type FlaggedItem = z.infer<typeof FlaggedItemSchema>

export async function readFlaggedSubmissionsAction() {
  await requireTeacherProfile()

  try {
    const { rows } = await query<{
      submission_id: string
      pupil_name: string
      activity_title: string
      lesson_id: string
      lesson_title: string
      group_id: string
      group_name: string
      submitted_at: string | null
    }>(
      `
        SELECT DISTINCT ON (s.submission_id)
          s.submission_id,
          TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))  AS pupil_name,
          a.title                                                                 AS activity_title,
          l.lesson_id,
          l.title                                                                 AS lesson_title,
          g.group_id,
          g.name                                                                  AS group_name,
          s.submitted_at
        FROM submissions         s
        JOIN profiles            p  ON p.user_id     = s.user_id
        JOIN activities          a  ON a.activity_id = s.activity_id
        JOIN lessons             l  ON l.lesson_id   = a.lesson_id
        JOIN lesson_assignments  la ON la.lesson_id  = l.lesson_id
        JOIN groups              g  ON g.group_id    = la.group_id
        WHERE s.is_flagged = true
        ORDER BY s.submission_id, s.submitted_at DESC NULLS LAST
      `,
    )

    const data = (rows ?? []).map((row) => ({
      submissionId: row.submission_id,
      pupilName: row.pupil_name,
      activityTitle: row.activity_title,
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title,
      groupId: row.group_id,
      groupName: row.group_name,
      submittedAt: row.submitted_at ?? null,
    }))

    return FlaggedResultSchema.parse({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load flagged submissions."
    console.error("[dashboard] readFlaggedSubmissionsAction failed", error)
    return FlaggedResultSchema.parse({ data: null, error: message })
  }
}

// ── Mentions ─────────────────────────────────────────────────────────────────

const MentionItemSchema = z.object({
  commentId: z.string(),
  submissionId: z.string(),
  pupilName: z.string(),
  comment: z.string(),
  lessonId: z.string(),
  lessonTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  createdAt: z.string(),
})

const MentionsResultSchema = z.object({
  data: MentionItemSchema.array().nullable(),
  error: z.string().nullable(),
})

export type MentionItem = z.infer<typeof MentionItemSchema>

export async function readMentionsAction() {
  await requireTeacherProfile()

  try {
    const { rows } = await query<{
      comment_id: string
      submission_id: string
      pupil_name: string
      comment: string
      lesson_id: string
      lesson_title: string
      group_id: string
      group_name: string
      created_at: string
    }>(
      `
        SELECT
          sc.id                                                                    AS comment_id,
          sc.submission_id,
          TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))   AS pupil_name,
          sc.comment,
          l.lesson_id,
          l.title                                                                  AS lesson_title,
          la.group_id,
          g.name                                                                   AS group_name,
          sc.created_at
        FROM submission_comments  sc
        JOIN submissions          s   ON s.submission_id  = sc.submission_id
        JOIN profiles             p   ON p.user_id        = sc.user_id
        JOIN activities           a   ON a.activity_id    = s.activity_id
        JOIN lessons              l   ON l.lesson_id      = a.lesson_id
        JOIN LATERAL (
          SELECT group_id FROM lesson_assignments WHERE lesson_id = l.lesson_id LIMIT 1
        ) la ON true
        JOIN groups               g   ON g.group_id       = la.group_id
        ORDER BY sc.created_at DESC
      `,
    )

    const data = (rows ?? []).map((row) => ({
      commentId: row.comment_id,
      submissionId: row.submission_id,
      pupilName: row.pupil_name,
      comment: row.comment,
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title,
      groupId: row.group_id,
      groupName: row.group_name,
      createdAt: row.created_at,
    }))

    return MentionsResultSchema.parse({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load mentions."
    console.error("[dashboard] readMentionsAction failed", error)
    return MentionsResultSchema.parse({ data: null, error: message })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep dashboard
```

Expected: no errors for `dashboard.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/dashboard.ts
git commit -m "feat: add dashboard server actions for marking queue, flagged, and mentions"
```

---

### Task 3: Submission comment server action

**Files:**
- Create: `src/lib/server-actions/submission-comments.ts`

- [ ] **Step 1: Write the action**

```typescript
"use server"

import { z } from "zod"
import { query } from "@/lib/db"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { emitSseEvent } from "@/lib/sse/hub"

const AddCommentInputSchema = z.object({
  submissionId: z.string().min(1),
  comment: z.string().trim().min(1).max(2000),
})

const AddCommentResultSchema = z.object({
  data: z.object({ commentId: z.string() }).nullable(),
  error: z.string().nullable(),
})

export async function addSubmissionCommentAction(
  input: z.infer<typeof AddCommentInputSchema>,
) {
  const profile = await requireAuthenticatedProfile()

  const parsed = AddCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    return AddCommentResultSchema.parse({ data: null, error: "Invalid input." })
  }

  // Verify the submission belongs to the calling user
  try {
    const { rows: ownerRows } = await query<{ submission_id: string }>(
      "SELECT submission_id FROM submissions WHERE submission_id = $1 AND user_id = $2 LIMIT 1",
      [parsed.data.submissionId, profile.userId],
    )
    if (!ownerRows?.[0]) {
      return AddCommentResultSchema.parse({
        data: null,
        error: "Submission not found or does not belong to you.",
      })
    }
  } catch (error) {
    console.error("[submission-comments] ownership check failed", error)
    return AddCommentResultSchema.parse({ data: null, error: "Unable to verify submission." })
  }

  // Insert comment
  let commentId: string
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO submission_comments (submission_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [parsed.data.submissionId, profile.userId, parsed.data.comment],
    )
    commentId = rows[0].id
  } catch (error) {
    console.error("[submission-comments] insert failed", error)
    return AddCommentResultSchema.parse({ data: null, error: "Unable to save comment." })
  }

  // Broadcast via SSE so the dashboard badge updates live
  await emitSseEvent({
    topic: "submissions",
    type: "submission.comment_added",
    payload: { commentId, submissionId: parsed.data.submissionId, userId: profile.userId },
  })

  return AddCommentResultSchema.parse({ data: { commentId }, error: null })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep submission-comments
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/submission-comments.ts
git commit -m "feat: add addSubmissionCommentAction with SSE broadcast"
```

---

### Task 4: Re-export from `server-updates.ts`

**Files:**
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Add exports at the bottom of the file**

Add these two export blocks at the end of `src/lib/server-updates.ts`:

```typescript
export {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
  type MarkingQueueItem,
  type FlaggedItem,
  type MentionItem,
} from "./server-actions/dashboard"

export {
  addSubmissionCommentAction,
} from "./server-actions/submission-comments"
```

- [ ] **Step 2: Verify**

```bash
pnpm tsc --noEmit 2>&1 | grep server-updates
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-updates.ts
git commit -m "chore: re-export dashboard and submission comment actions"
```

---

## Chunk 2: Dashboard Components

### Task 5: Marking queue panel

**Files:**
- Create: `src/components/teacher-dashboard/marking-queue-panel.tsx`

- [ ] **Step 1: Write the component**

```typescript
import Link from "next/link"
import { readMarkingQueueAction } from "@/lib/server-updates"

export async function MarkingQueuePanel() {
  const { data: items, error } = await readMarkingQueueAction()

  const queue = items ?? []
  const totalSubmissions = queue.reduce((sum, item) => sum + item.submissionCount, 0)

  return (
    <section className="flex-[2] border-r border-slate-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-amber-400">
            Needs Review
          </span>
          <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-400">
            {totalSubmissions}
          </span>
        </div>
        <span className="text-xs text-slate-500">AI-marked · awaiting teacher review</span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : queue.length === 0 ? (
        <p className="text-xs text-slate-500">No lessons awaiting review.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {queue.map((item) => (
            <li
              key={`${item.lessonId}-${item.groupId}`}
              className="flex items-center justify-between rounded-md border-l-[3px] border-amber-400 bg-slate-800 px-3 py-2.5"
            >
              <div>
                <Link
                  href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
                  className="text-sm font-semibold text-amber-300 underline decoration-amber-400/50 underline-offset-2 hover:decoration-amber-400"
                >
                  {item.lessonTitle} ↗
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {item.groupName} · {item.unitTitle}
                </p>
              </div>
              <div className="ml-4 shrink-0 text-right">
                <p className="text-base font-bold text-amber-400">{item.submissionCount}</p>
                <p className="text-xs text-slate-500">pupils</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep marking-queue
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-dashboard/marking-queue-panel.tsx
git commit -m "feat: add MarkingQueuePanel server component"
```

---

### Task 6: Flagged submissions panel

**Files:**
- Create: `src/components/teacher-dashboard/flagged-panel.tsx`

- [ ] **Step 1: Write the component**

```typescript
import Link from "next/link"
import { readFlaggedSubmissionsAction } from "@/lib/server-updates"

export async function FlaggedPanel() {
  const { data: items, error } = await readFlaggedSubmissionsAction()

  const flagged = items ?? []

  return (
    <section className="flex-1 border-b border-slate-800 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-red-400">Flagged</span>
        <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-bold text-red-400">
          {flagged.length}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : flagged.length === 0 ? (
        <p className="text-xs text-slate-500">No flagged submissions.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {flagged.map((item) => (
            <li
              key={item.submissionId}
              className="rounded-md border-l-2 border-red-400 bg-slate-800 px-3 py-2"
            >
              <Link
                href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
                className="block"
              >
                <p className="text-xs font-semibold text-red-300 hover:underline">
                  {item.pupilName}
                </p>
                <p className="text-xs text-slate-400">{item.activityTitle}</p>
                <p className="mt-0.5 text-xs text-slate-500">{item.groupName}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-dashboard/flagged-panel.tsx
git commit -m "feat: add FlaggedPanel server component"
```

---

### Task 7: Mentions panel

**Files:**
- Create: `src/components/teacher-dashboard/mentions-panel.tsx`

- [ ] **Step 1: Write the component**

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
    <section className="flex-1 p-4">
      <div className="mb-3 flex items-center gap-2">
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
        <ul className="flex flex-col gap-1.5">
          {mentions.map((item) => (
            <li
              key={item.commentId}
              className="rounded-md border-l-2 border-blue-400 bg-slate-800 px-3 py-2"
            >
              <Link
                href={`/feedback/groups/${encodeURIComponent(item.groupId)}/lessons/${encodeURIComponent(item.lessonId)}`}
                className="block"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-300 hover:underline">
                    {item.pupilName}
                  </p>
                  <p className="text-xs text-slate-500">{timeAgo(item.createdAt)}</p>
                </div>
                <p className="mt-1 text-xs italic text-slate-400 line-clamp-2">
                  &ldquo;{item.comment}&rdquo;
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{item.groupName}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-dashboard/mentions-panel.tsx
git commit -m "feat: add MentionsPanel server component"
```

---

### Task 8: Dashboard client — SSE badge updates

**Files:**
- Create: `src/components/teacher-dashboard/dashboard-client.tsx`

This is a `"use client"` component that wraps the panels and manages live badge counts via SSE.

- [ ] **Step 1: Write the component**

```typescript
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import type { SseEventEnvelope } from "@/lib/sse/types"
import {
  readMarkingQueueAction,
  readFlaggedSubmissionsAction,
  readMentionsAction,
} from "@/lib/server-updates"

type Props = {
  initialMarkingCount: number
  initialFlaggedCount: number
  initialMentionsCount: number
  children: React.ReactNode
}

type LiveStatus = "connecting" | "connected" | "reconnecting" | "error"

export function DashboardClient({
  initialMarkingCount,
  initialFlaggedCount,
  initialMentionsCount,
  children,
}: Props) {
  const [markingCount, setMarkingCount] = useState(initialMarkingCount)
  const [flaggedCount, setFlaggedCount] = useState(initialFlaggedCount)
  const [mentionsCount, setMentionsCount] = useState(initialMentionsCount)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting")
  const sourceRef = useRef<EventSource | null>(null)

  const refetchCounts = useCallback(async () => {
    const [markingResult, flaggedResult, mentionsResult] = await Promise.all([
      readMarkingQueueAction(),
      readFlaggedSubmissionsAction(),
      readMentionsAction(),
    ])
    if (markingResult.data)  setMarkingCount(markingResult.data.reduce((s, i) => s + i.submissionCount, 0))
    if (flaggedResult.data)  setFlaggedCount(flaggedResult.data.length)
    if (mentionsResult.data) setMentionsCount(mentionsResult.data.length)
  }, [])

  useEffect(() => {
    const source = new EventSource("/sse?topics=submissions,assignments")
    sourceRef.current = source

    source.onopen = () => {
      setLiveStatus("connected")
      // Refetch on (re)connect to reset counts from authoritative source
      refetchCounts()
    }

    source.onerror = () => {
      setLiveStatus("reconnecting")
    }

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const envelope = JSON.parse(event.data) as SseEventEnvelope

        if (
          envelope.topic === "assignments" &&
          envelope.type === "assignment.results.updated" &&
          envelope.payload?.aiScore
        ) {
          setMarkingCount((c) => c + 1)
        }

        if (envelope.topic === "submissions" && envelope.type === "submission.flagged") {
          setFlaggedCount((c) => c + 1)
        }

        if (envelope.topic === "submissions" && envelope.type === "submission.comment_added") {
          setMentionsCount((c) => c + 1)
        }
      } catch {
        // Ignore malformed events (pings arrive as non-JSON comments)
      }
    }

    return () => {
      source.close()
    }
  }, [refetchCounts])

  const dotColor =
    liveStatus === "connected"
      ? "bg-green-500"
      : liveStatus === "connecting" || liveStatus === "reconnecting"
        ? "bg-amber-500"
        : "bg-red-500"

  return (
    <div
      data-marking-count={markingCount}
      data-flagged-count={flaggedCount}
      data-mentions-count={mentionsCount}
      data-live-status={liveStatus}
    >
      {/* Live status bar — passed as context via data attributes; panels read server-rendered counts */}
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-5 py-3">
        <div className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-xs text-slate-500">
          {liveStatus === "connected" ? "Live" : liveStatus === "reconnecting" ? "Reconnecting..." : "Offline"}
        </span>
        <span className="ml-auto text-xs text-slate-500">
          {markingCount > 0 && (
            <span className="mr-3 font-semibold text-amber-400">{markingCount} to review</span>
          )}
          {flaggedCount > 0 && (
            <span className="mr-3 font-semibold text-red-400">{flaggedCount} flagged</span>
          )}
          {mentionsCount > 0 && (
            <span className="font-semibold text-blue-400">{mentionsCount} mentions</span>
          )}
        </span>
      </div>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep dashboard-client
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-dashboard/dashboard-client.tsx
git commit -m "feat: add DashboardClient SSE badge updater"
```

---

## Chunk 3: Root Page, Pupil Comment Input, and E2E Tests

### Task 9: Replace root page with teacher dashboard

**Files:**
- Replace: `src/app/page.tsx`

- [ ] **Step 1: Write the new root page**

```typescript
export const dynamic = "force-dynamic"

import Link from "next/link"
import { Suspense } from "react"
import { requireTeacherProfile } from "@/lib/auth"
import { readMarkingQueueAction, readFlaggedSubmissionsAction, readMentionsAction } from "@/lib/server-updates"
import { MarkingQueuePanel } from "@/components/teacher-dashboard/marking-queue-panel"
import { FlaggedPanel } from "@/components/teacher-dashboard/flagged-panel"
import { MentionsPanel } from "@/components/teacher-dashboard/mentions-panel"
import { DashboardClient } from "@/components/teacher-dashboard/dashboard-client"

export default async function TeacherDashboardPage() {
  const profile = await requireTeacherProfile()

  // Fetch initial counts for DashboardClient (panels fetch their own full data)
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
      {/* Top bar */}
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
        {/* Panel layout: wide left + stacked right */}
        <div className="flex min-h-[calc(100vh-88px)]">
          <Suspense fallback={<PanelSkeleton className="flex-[2] border-r border-slate-800" />}>
            <MarkingQueuePanel />
          </Suspense>

          <div className="flex flex-1 flex-col">
            <Suspense fallback={<PanelSkeleton className="flex-1 border-b border-slate-800" />}>
              <FlaggedPanel />
            </Suspense>
            <Suspense fallback={<PanelSkeleton className="flex-1" />}>
              <MentionsPanel />
            </Suspense>
          </div>
        </div>
      </DashboardClient>
    </main>
  )
}

function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse p-4 ${className ?? ""}`}>
      <div className="mb-3 h-3 w-24 rounded bg-slate-800" />
      <div className="space-y-2">
        <div className="h-10 rounded bg-slate-800" />
        <div className="h-10 rounded bg-slate-800" />
        <div className="h-10 rounded bg-slate-800" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Start dev server and verify the dashboard loads**

Navigate to `http://localhost:3000` — sign in as a teacher and confirm:
- The three panels render (or show "No items" empty states)
- The top bar shows the teacher's name and "Assignments →" link
- The "Live" / "Connecting" status appears in the SSE bar

- [ ] **Step 3: Verify unauthenticated users are redirected**

Open a private browser tab and navigate to `http://localhost:3000`. Confirm redirect to `/signin`.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: replace root page with teacher dashboard"
```

---

### Task 10: Pupil submission comment input

**Files:**
- Create: `src/components/submission-comment-input.tsx`
- Modify: `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`

- [ ] **Step 1: Write the `SubmissionCommentInput` client component**

```typescript
"use client"

import { useState, useTransition } from "react"
import { addSubmissionCommentAction } from "@/lib/server-updates"
import { toast } from "sonner"

type Props = {
  submissionId: string
}

export function SubmissionCommentInput({ submissionId }: Props) {
  const [comment, setComment] = useState("")
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return

    startTransition(async () => {
      const { error } = await addSubmissionCommentAction({ submissionId, comment: comment.trim() })
      if (error) {
        toast.error(error)
      } else {
        setSent(true)
        setComment("")
        toast.success("Note sent to teacher.")
      }
    })
  }

  if (sent) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        ✓ Your note has been sent to the teacher.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Leave a note for your teacher (optional)..."
        rows={2}
        maxLength={2000}
        className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        disabled={isPending}
      />
      <button
        type="submit"
        disabled={isPending || !comment.trim()}
        className="self-end rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send note"}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Add the comment input to the pupil lesson page**

In `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`, find the import block at the top and add:

```typescript
import { SubmissionCommentInput } from "@/components/submission-comment-input"
```

Then, locate where submission data is rendered per activity. Find the block that renders after a short-text submission is submitted (look for the `status === "submitted"` or similar completion state) and add the `SubmissionCommentInput` beneath it. The exact insertion point will vary but should look like:

```tsx
{submission && submission.status === "submitted" && (
  <SubmissionCommentInput submissionId={submission.submission_id} />
)}
```

Place this inside the activity card, below the submission body display, for each activity type that has a `submission_id`.

- [ ] **Step 3: Verify in browser**

Sign in as a pupil, navigate to a lesson, submit an activity, and confirm the "Leave a note" textarea appears below the submitted answer. Submit a note and confirm the toast appears.

- [ ] **Step 4: Commit**

```bash
git add src/components/submission-comment-input.tsx
git add src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx
git commit -m "feat: add pupil submission comment input"
```

---

### Task 11: Playwright E2E tests

**Files:**
- Create: `tests/dashboard/teacher-dashboard.spec.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { expect, test } from "@playwright/test"

const TEACHER_EMAIL = "mr.salih@bisak.org" // update to match test env credentials
const TEACHER_PASSWORD = "bisak123"

test.describe("Teacher dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin")
    await page.getByLabel("Email address").fill(TEACHER_EMAIL)
    await page.getByLabel("Password").fill(TEACHER_PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.waitForURL("/")
  })

  test("teacher sees dashboard at root after sign-in", async ({ page }) => {
    await expect(page).toHaveURL("/")
    await expect(page.getByText("Teacher Dashboard")).toBeVisible()
    await expect(page.getByText("Needs Review")).toBeVisible()
    await expect(page.getByText("Flagged")).toBeVisible()
    await expect(page.getByText("Mentions")).toBeVisible()
  })

  test("Assignments link navigates to assignment manager", async ({ page }) => {
    await page.getByRole("link", { name: "Assignments →" }).click()
    await expect(page).toHaveURL("/assignments")
  })

  test("unauthenticated user is redirected to sign in", async ({ page }) => {
    // Clear session
    await page.context().clearCookies()
    await page.goto("/")
    await expect(page).toHaveURL(/\/signin/)
  })

  test("lesson title in needs-review panel links to feedback page", async ({ page }) => {
    // Only runs if there are items in the queue
    const firstLink = page.locator("section").first().getByRole("link").first()
    const count = await firstLink.count()
    test.skip(count === 0, "No items in marking queue in test environment")
    if (count === 0) return
    const href = await firstLink.getAttribute("href")
    expect(href).toMatch(/\/feedback\/groups\/.+\/lessons\/.+/)
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
pnpm test tests/dashboard/teacher-dashboard.spec.ts
```

Expected: all tests pass (or the lesson-link test is skipped if queue is empty in test env).

- [ ] **Step 3: Commit**

```bash
git add tests/dashboard/teacher-dashboard.spec.ts
git commit -m "test: add Playwright E2E tests for teacher dashboard"
```

---

## Final verification

- [ ] Run full lint: `pnpm lint` — no errors
- [ ] Run full type check: `pnpm tsc --noEmit` — no errors
- [ ] Open `http://localhost:3000` as teacher — all three panels visible
- [ ] Confirm SSE "Live" status dot turns green within a few seconds of page load
- [ ] Confirm "Assignments →" link works
- [ ] Open `http://localhost:3000` in an incognito window — redirects to `/signin`
