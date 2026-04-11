# Dashboard Mark All Button — Design Spec

## Goal

Add a "Mark All" button to each lesson card in the teacher dashboard's Needs Review panel. Clicking it queues all unscored short-text submissions for that lesson+group for AI marking.

## Context

The results page (`/results/assignments/[assignmentId]`) already has a "Mark All" button that calls `triggerBulkAiMarkingAction`. This feature brings the same capability to the dashboard so teachers can trigger marking without navigating to each assignment.

The Needs Review panel already queries for lessons with unscored short-text submissions. The count shown is `compute_submission_base_score IS NULL` — the same condition used to find submissions to enqueue.

## Components

### 1. Server Action — `markAllUnmarkedForLessonAction`

**File:** `src/lib/server-actions/dashboard.ts`

**Input:** `{ groupId: string, lessonId: string }`

**Behaviour:**
- Calls `requireTeacherProfile()` for auth
- Queries DB for all `submission_id` values where:
  - `a.type = 'short-text-question'`
  - `compute_submission_base_score(s.body, a.type) IS NULL`
  - `la.group_id = groupId` (must be explicit to avoid cross-group leakage when a lesson is assigned to multiple groups)
  - Pupil belongs to `groupId` via `group_membership`
  - Activity belongs to `lessonId`
- Constructs `assignmentId = groupId + "__" + lessonId` (matches the separator used throughout the codebase; routes the queue processor to `/webhooks/ai-mark`)
- Calls `enqueueMarkingTasks(assignmentId, submissions)` and `triggerQueueProcessor()` **directly** — must NOT delegate to `triggerBulkAiMarkingAction`, which has no auth guard
- Does **not** call `revalidatePath`; client-side `router.refresh()` is the correct invalidation mechanism
- Returns `{ success: boolean, count: number, error: string | null }` — intentional deviation from the `{ data, error }` pattern used by read actions; `count` is needed for the toast message
- Wrapped in `withTelemetry`

**Re-exported** via `src/lib/server-updates.ts`.

### 2. Client Component — `MarkAllButton`

**File:** `src/components/teacher-dashboard/mark-all-button.tsx`

**Props:** `{ groupId: string, lessonId: string }`

**Behaviour:**
- `"use client"` component
- Button label: "Mark All" → "Queuing…" while pending
- On success: `toast.success("Queued N submissions for marking.")` + `router.refresh()` to update counts
- On error: `toast.error(message)`
- Uses `useTransition` for pending state; button disabled while pending

### 3. UI — `MarkingQueuePanel`

**File:** `src/components/teacher-dashboard/marking-queue-panel.tsx`

`MarkingQueuePanel` remains a **server component** — do not add `"use client"`. The client boundary starts at `MarkAllButton`. Server components can render client components; no structural change to the panel is needed beyond importing and rendering `MarkAllButton`.

Each lesson card currently shows:
```
[Lesson title ↗]            [count]
[group · unit · groupId]    activities
```

Updated layout:
```
[Lesson title ↗]            [count]
[group · unit · groupId]    activities
                            [Mark All]
```

The `MarkAllButton` sits below the count/activities on the right side of each card.

## Data Flow

```
MarkAllButton (click)
  → markAllUnmarkedForLessonAction({ groupId, lessonId })
    → requireTeacherProfile()
    → SELECT submission_id WHERE unscored + lesson + group
    → enqueueMarkingTasks(assignmentId, submissions)
    → triggerQueueProcessor()
    → return { success, count, error }
  → toast feedback
  → router.refresh() → panel re-fetches → count updates
```

## Out of Scope

- No real-time progress tracking (toast + refresh is sufficient)
- No confirmation dialog (matches existing results page behaviour)
- No per-activity granularity (whole lesson at once)
