# Resubmit Work

## Overview

Allow teachers to mark individual pupil activities as requiring resubmission from the `/results/assignments/[assignmentId]` sidebar. Resubmission requests surface clearly to pupils on their `/pupil-lessons` page and a dedicated **My Tasks** page so they know what needs redoing.

## Decisions

| Question | Decision |
|----------|----------|
| Teacher note visibility | Visible to the pupil alongside the resubmit warning |
| Score while pending | Zeroed out (old score not preserved) |
| Activity types | All types (short-text, upload, sketch, MCQ) |
| Sidebar pill scope | Selected subject only (updates with subject dropdown) |
| Old score preservation | Not preserved - just zeroed |
| Re-marking after resubmit | Auto-score runs again (AI/auto for applicable types), teacher reviews as usual |
| Bulk resubmit | Per-pupil only (individual cell action in results sidebar) |
| Data model | New columns on `submissions`: `resubmit_requested` (boolean) + `resubmit_note` (text) |
| Button placement | Inside the Override tab in the results sidebar |
| My Tasks grouping | Grouped by subject, sorted by date descending within each group |

## Teacher Flow (Results Sidebar)

- In the **Override tab** of the results sidebar, the teacher can mark the activity as **"Requires Resubmission"**.
- A text field allows the teacher to add a note explaining what needs improving (visible to the pupil).
- This sets `resubmit_requested = true` and `resubmit_note` on the submission, and zeros out the score.
- The resubmit state is visible in the results grid cell (e.g. a resubmit icon alongside existing indicators).
- Once the pupil resubmits, auto-scoring runs again for applicable types. The teacher can then review, override, or request resubmission again.

## Pupil Flow (Pupil Lessons Page)

### Side Menu Pills

1. **Resubmission pill** - A pill/badge next to unit names in the sidebar showing the count of lessons with pending resubmissions within that unit. Scoped to the currently selected subject.
2. **Underperforming pill** - A pill/badge showing the count of lessons coloured red (overdue and below 80%) within the selected subject, using the existing `isLessonOverdueAndUnderperforming` logic.

### Lesson-Level Warning

- Lessons that contain activities requiring resubmission display a visible warning banner within the lesson card.
- The warning includes the teacher's note.

### Activity-Level Indicator

- On the individual lesson page (`/pupil-lessons/[pupilId]/lessons/[lessonId]`), activities flagged for resubmission show a prominent warning with the teacher's note.
- The pupil can resubmit their answer. On submission, `resubmit_requested` clears and auto-scoring runs. The teacher is notified via existing realtime/SSE channels.

## My Tasks Page

A new pupil-facing page at `/tasks` accessible via a **My Tasks** nav link (added alongside My Units, Specs, My Reports).

### Content

Lists all actionable items for the pupil, grouped by subject and sorted by date descending (most recent first) within each group. Two types of items:

1. **Resubmission required** - Lessons with activities where `resubmit_requested = true`. Shows the lesson title, activity name, teacher's note, and a link to the lesson page.
2. **Underperforming** - Lessons that are overdue and below 80% (same logic as `isLessonOverdueAndUnderperforming`). Shows the lesson title, current score, and a link to the lesson page.

Each item has a badge/icon distinguishing its type (resubmit vs underperforming) and links directly to the lesson page.

### Empty State

When there are no tasks, show a positive message (e.g. "All caught up - no tasks to complete").

## Data Model

New columns on the `submissions` table:

```sql
ALTER TABLE public.submissions
  ADD COLUMN resubmit_requested boolean DEFAULT false NOT NULL,
  ADD COLUMN resubmit_note text;
```

- `resubmit_requested`: set to `true` by the teacher, cleared to `false` when the pupil resubmits.
- `resubmit_note`: teacher's explanation of what needs improving. Cleared on resubmit.
