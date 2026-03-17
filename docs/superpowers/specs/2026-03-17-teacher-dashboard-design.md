# Teacher Dashboard — Design Spec

**Date:** 2026-03-17
**Status:** Approved
**Route:** `/` (replaces current home page)

---

## Overview

A teacher dashboard that replaces the current root page (`/`) and serves as the first screen a teacher sees after login. It surfaces three actionable panels in real time: lessons needing review after AI marking, flagged pupil submissions, and pupil mentions (comments on submissions requesting teacher attention). Counts update live via the existing SSE infrastructure without a page refresh.

---

## Layout

**Option B — Wide left + stacked right.**

```
┌─────────────────────────────────────┬──────────────────────┐
│                                     │  Flagged (3)         │
│   Needs Review (12)                 │  · Sara K. Lesson 4  │
│   · Lesson 4 — Year 10 A  8 pupils  │  · Tom R. Lesson 2   │
│   · Lesson 2 — Year 9 B   6 pupils  │  · Priya S. Lesson 7 │
│   · Lesson 7 — Year 11 A  4 pupils  ├──────────────────────┤
│   · ...                             │  Mentions (5)        │
│                                     │  · Aisha M. 2m ago   │
│                                     │  · Jake T. 14m ago   │
└─────────────────────────────────────┴──────────────────────┘
```

- **Top bar:** teacher name, "Live" SSE status dot, "Assignments →" escape link to existing assignment manager
- **Left panel (flex: 2):** marking queue — most common daily task, gets the most space
- **Right panel (flex: 1):** flagged and mentions stacked vertically
- Each lesson row title is a direct link (amber, underlined, ↗) to `/feedback/groups/[groupId]/lessons/[lessonId]`
- Lessons with no submissions yet shown greyed out at the bottom of the queue

---

## Panels

### 1. Needs Review

Lessons where the AI has scored at least one short-text submission but the teacher has not yet set `teacher_override_score`. This is the teacher's marking queue.

**Definition:** a lesson appears here if it has any submission where:
- The associated activity has `type = 'short-text-question'`
- `(submissions.body->>'ai_model_score') IS NOT NULL`
- `(submissions.body->>'teacher_override_score') IS NULL`

These fields live inside `submissions.body` (jsonb) — they are **not** top-level columns. All predicates must use JSON extraction operators.

**Join chain required:**
```
submissions
  → activities       ON submissions.activity_id = activities.activity_id
  → lessons          ON activities.lesson_id = lessons.lesson_id
  → lesson_assignments ON lessons.lesson_id = lesson_assignments.lesson_id
  → groups           ON lesson_assignments.group_id = groups.group_id
  → units            ON lessons.unit_id = units.unit_id
```

Grouped by `(lessons.lesson_id, lessons.title, groups.group_id, groups.name, units.title)`. Returns submission count per lesson. Ordered by `submission_count DESC`.

**Teacher scoping:** This app is currently single-teacher. No group-membership scoping is required at this time. If multiple teachers are added later, add a `WHERE group_id IN (SELECT group_id FROM group_membership WHERE user_id = $teacherId)` clause.

**Link destination:** `/feedback/groups/[groupId]/lessons/[lessonId]` — the existing lesson feedback page.

---

### 2. Flagged

Submissions where `is_flagged = true`. The `submissions` table has an `is_flagged boolean` column but **no `flagged_at` column**. Order by `submitted_at DESC` instead.

**Join chain required:**
```
submissions
  → profiles         ON submissions.user_id = profiles.user_id        (→ profiles.full_name as pupil_name)
  → activities       ON submissions.activity_id = activities.activity_id  (→ activities.title as activity_title)
  → lessons          ON activities.lesson_id = lessons.lesson_id
  → lesson_assignments ON lessons.lesson_id = lesson_assignments.lesson_id
  → groups           ON lesson_assignments.group_id = groups.group_id
```

**Teacher scoping:** Single-teacher app — no scoping required at this time.

**Link destination:** `/feedback/groups/[groupId]/lessons/[lessonId]` — no anchor to specific pupil (no anchor mechanism exists on that page; anchoring is out of scope for this spec).

---

### 3. Mentions

Pupil comments on submissions requesting teacher attention. New feature — requires migration and new UI on the pupil submission view.

**New table (migration `068_add_submission_comments.sql`):**
```sql
CREATE TABLE submission_comments (
  id            text        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id text        NOT NULL REFERENCES submissions(submission_id),
  user_id       text        NOT NULL REFERENCES profiles(user_id),
  comment       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_submission ON submission_comments (submission_id);
CREATE INDEX idx_sc_user       ON submission_comments (user_id);
```

Note: uses `text DEFAULT gen_random_uuid()` to match the existing PK convention throughout the schema (e.g. `peer_review_comments`, `submissions`).

Shows per item: pupil name, comment preview (truncated to ~80 chars), lesson title, group name, relative time. Ordered by `created_at DESC`.

**Teacher scoping:** Single-teacher app — no scoping required at this time.

**Pupil side:** a small comment input added to the submission view (`/pupil-lessons/[pupilId]/lessons/[lessonId]`) allowing pupils to leave a note on any submitted activity.

---

## Real-Time Updates (SSE)

The dashboard server-renders the initial counts. A client component `DashboardClient` mounts and subscribes to:

```
/sse?topics=submissions,assignments
```

### Event types to handle

| Topic | Event type | Action |
|---|---|---|
| `assignments` | `assignment.results.updated` | Increment Needs Review count |
| `submissions` | `submission.flagged` | Increment Flagged count |
| `submissions` | `submission.comment_added` | Increment Mentions count |

The `assignment.results.updated` event is emitted by `src/lib/results-sse.ts` when AI marking completes. Its payload contains `aiScore`, `aiFeedback`, `activityId`, `pupilId`, and `assignmentId`. The client should inspect for a truthy `aiScore` field to confirm it is a marking completion before incrementing the Needs Review count.

### Reconnect / replay handling

The SSE hub replays recent events to late-joining clients. To avoid double-counting on reconnect, `DashboardClient` must **refetch all three counts** via the server actions when the SSE connection is re-established (i.e. on the `reconnect` event or equivalent). Counts are reset to the freshly fetched values, not incremented from the replayed stream.

### Connection status indicator

The "Live" dot in the top bar reflects SSE connection state:
- Green → connected
- Amber → reconnecting
- Red → error / disconnected

---

## Routing & Auth

- Route: `src/app/page.tsx` — replaces current DB status page entirely
- Auth guard: call `requireRole('teacher')` at the top of the page
  - Unauthenticated → redirects to `/signin` (handled by `requireRole`)
  - Non-teacher (pupil) → redirects to `/profiles` (handled by `requireRole` — note: this redirects to `/profiles`, not to the per-pupil `/profiles/[id]/dashboard`, which is the existing behaviour of `requireRole`)
- `export const dynamic = "force-dynamic"` to prevent static caching

---

## New Files

```
src/app/page.tsx                                    ← replaced (server component)
src/components/teacher-dashboard/
  marking-queue-panel.tsx                           ← server component, own Suspense boundary
  flagged-panel.tsx                                 ← server component, own Suspense boundary
  mentions-panel.tsx                                ← server component, own Suspense boundary
  dashboard-client.tsx                              ← client component, SSE subscription + badge state
src/lib/server-actions/dashboard.ts                ← readMarkingQueueAction, readFlaggedSubmissionsAction, readMentionsAction
src/lib/server-actions/submission-comments.ts      ← addSubmissionCommentAction
src/migrations/068_add_submission_comments.sql     ← new table
```

---

## Data Contracts

### `readMarkingQueueAction()`
Returns `{ data: MarkingQueueItem[], error }`:
```ts
type MarkingQueueItem = {
  lessonId: string
  lessonTitle: string
  groupId: string
  groupName: string
  unitTitle: string
  submissionCount: number
}
```

### `readFlaggedSubmissionsAction()`
Returns `{ data: FlaggedItem[], error }`:
```ts
type FlaggedItem = {
  submissionId: string
  pupilName: string
  activityTitle: string
  lessonId: string
  lessonTitle: string
  groupId: string
  groupName: string
  submittedAt: string    // no flagged_at column — use submitted_at
}
```

### `readMentionsAction()`
Returns `{ data: MentionItem[], error }`:
```ts
type MentionItem = {
  commentId: string
  submissionId: string
  pupilName: string
  comment: string
  lessonId: string
  lessonTitle: string
  groupId: string
  groupName: string
  createdAt: string
}
```

### `addSubmissionCommentAction(submissionId, comment)`
- Requires `requireAuthenticatedProfile()` — any authenticated user (pupils only in practice)
- Verifies `submission.user_id = callingUser.userId` before inserting — pupils can only comment on their own submissions
- Inserts a row into `submission_comments`
- Broadcasts on the `submissions` SSE topic with event type `submission.comment_added`
- Returns `{ data: { commentId: string }, error }`

---

## Out of Scope

- Filtering by group/class — show all for now
- Marking comments as read — all mentions shown (future work)
- Pupil-facing notification that teacher has seen their comment (future work)
- Anchoring flagged item links to specific pupil on the feedback page (future work)
- Multi-teacher scoping — single-teacher app for now
- Dashboard for pupils — existing `/profiles/[id]/dashboard` is unchanged
