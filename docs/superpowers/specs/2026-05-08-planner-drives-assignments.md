# Planner Drives Assignments Design

## Goal

Make the teacher planner the primary workflow for lesson assignment. Scheduling a lesson in the planner immediately makes it visible to pupils. The existing `lesson_assignments` table is replaced by a Postgres view derived from `planner_assignments`, so all pupil-facing queries continue to work unchanged. The `/assignments` page becomes a read-only view of what the planner has scheduled.

## Architecture

```
planner_assignments  (sole write path — one row per lesson per slot)
       │
       ├── lesson_assignments VIEW  (read-only, derived — all pupil queries unchanged)
       │       group_id, lesson_id, start_date, hidden=FALSE, locked=FALSE, feedback_visible
       │
       ├── PlannerGrid cells  (1 lesson → title; 2+ lessons → "Lesson plan")
       └── SidePanel          (list all lessons per slot; add / remove individual lessons)
```

**Tech Stack:** Next.js 15, React 19, TypeScript, PostgreSQL, Tailwind CSS v4, Zod

---

## Section 1 — Data Model

### `planner_assignments` schema change

Remove the current unique constraint `(group_id, week_start_date, day, period)` and replace with `(group_id, week_start_date, day, period, lesson_id)`. This allows multiple lessons per slot. Each row is one lesson in one slot.

```sql
ALTER TABLE planner_assignments
  DROP CONSTRAINT planner_assignments_group_id_week_start_date_day_period_key,
  ADD CONSTRAINT planner_assignments_group_lesson_slot_unique
    UNIQUE (group_id, week_start_date, day, period, lesson_id);
```

### `CellState` type (TypeScript)

Replace the flat `lessonId / unitId / assignmentId / feedbackVisible / issueFlag / issueNote / lessonNotes` fields with a `lessons` array. Each element corresponds to one `planner_assignments` row for that slot.

```typescript
// src/components/teacher-planner/types.ts

export type SlotLesson = {
  lessonId: string
  unitId: string
  assignmentId: string
  feedbackVisible: boolean
  issueFlag: boolean
  issueNote: string
  lessonNotes: string
}

export type CellState = {
  groupId: string | null
  lessons: SlotLesson[]   // empty array = no lessons assigned to this slot
}
```

`emptyCellState()` returns `{ groupId: null, lessons: [] }`.

### `lesson_assignments` view

Replaces the existing table with a view of the same name. Existing pupil-facing SQL queries require **no changes**.

```sql
CREATE VIEW lesson_assignments AS
SELECT
  group_id,
  lesson_id,
  MIN(week_start_date)::date  AS start_date,
  FALSE                       AS hidden,
  FALSE                       AS locked,
  BOOL_OR(feedback_visible)   AS feedback_visible
FROM planner_assignments
GROUP BY group_id, lesson_id;
```

---

## Section 2 — Cell and Side Panel Behaviour

### Cell display

| Slot state | Cell shows | Lesson control |
|---|---|---|
| 0 lessons | empty | Unit + lesson dropdowns, selectable |
| 1 lesson | lesson title | Lesson dropdown, swappable |
| 2+ lessons | "Lesson plan" | Dropdowns hidden — manage via side panel |

When the teacher picks a different lesson from the cell (1-lesson state): delete the existing `planner_assignments` row for the old lesson, insert a new one for the new lesson. `deletePlannerAssignmentAction` gains a `lessonId` parameter so it targets a specific lesson rather than clearing the entire slot.

### Side panel — multiple lesson management

When a slot has lessons, the side panel shows a lesson list. Each row displays:
- Lesson title (unit name / lesson name)
- Feedback visible toggle
- Issue flag + issue note
- Lesson notes
- Remove button (deletes that specific `planner_assignments` row)

An **Add lesson** section at the bottom of the list provides unit + lesson dropdowns to add a further lesson to the slot. This calls `upsertPlannerAssignmentAction` with the slot coordinates and the new `lessonId`.

The side panel shows this lesson list regardless of whether the slot has 1 or multiple lessons, so it is always the place to manage extras and per-lesson flags.

---

## Section 3 — Migration

### Migrate existing `lesson_assignments` into `planner_assignments`

Before dropping the table, existing records are migrated. Each record is placed in the first timetable slot of its week for that group (first by day, then by period), determined by `timetable_slot_groups`.

```sql
INSERT INTO planner_assignments (group_id, lesson_id, week_start_date, day, period)
SELECT
  la.group_id,
  la.lesson_id,
  (la.start_date - EXTRACT(DOW FROM la.start_date)::int)  AS week_start_date,
  first_slot.day,
  first_slot.period
FROM lesson_assignments la
JOIN (
  SELECT DISTINCT ON (group_id) group_id, day, period
  FROM timetable_slot_groups
  ORDER BY
    group_id,
    CASE day
      WHEN 'sunday'    THEN 0
      WHEN 'monday'    THEN 1
      WHEN 'tuesday'   THEN 2
      WHEN 'wednesday' THEN 3
      WHEN 'thursday'  THEN 4
    END,
    period
) first_slot ON first_slot.group_id = la.group_id
ON CONFLICT DO NOTHING;
```

Groups with no entry in `timetable_slot_groups` are skipped (their lesson assignments do not migrate). Teachers must set up their timetable defaults in the planner before historical data can be placed.

### Drop table, create view

```sql
DROP TABLE lesson_assignments;

CREATE VIEW lesson_assignments AS
SELECT
  group_id,
  lesson_id,
  MIN(week_start_date)::date  AS start_date,
  FALSE                       AS hidden,
  FALSE                       AS locked,
  BOOL_OR(feedback_visible)   AS feedback_visible
FROM planner_assignments
GROUP BY group_id, lesson_id;
```

Migration file: `src/migrations/20260508_lesson_assignments_view.sql`

---

## Section 4 — Server Action Changes

### `src/lib/server-actions/planner-assignments.ts`

`deletePlannerAssignmentAction` signature changes:
```typescript
// Before
deletePlannerAssignmentAction(groupId, weekStartDate, day, period)

// After
deletePlannerAssignmentAction(groupId, lessonId, weekStartDate, day, period)
```

The SQL `WHERE` clause adds `AND lesson_id = $lessonId` so only the targeted lesson is removed from the slot.

`readPlannerAssignmentsForWeekAction` returns all rows for the week (already the case). The client groups them by slot key when building `weeklyStates`.

### `src/lib/server-actions/lesson-assignments.ts`

Delete the following write actions (no longer needed — planner is the write path):
- `upsertLessonAssignmentAction`
- `deleteLessonAssignmentAction`
- `toggleLessonAssignmentVisibilityAction`
- `toggleLessonAssignmentLockedAction`
- `toggleLessonAssignmentFeedbackVisibilityAction`

Keep:
- `readLessonAssignmentsAction` (reads from view — still works)
- `checkLessonAccessForPupilAction` (reads from view — still works; always returns accessible since hidden/locked are FALSE)

### `src/lib/server-updates.ts`

Remove exports of the five deleted write actions above.

---

## Section 5 — TeacherPlannerClient Changes

### Loading week assignments

`loadWeekAssignments` receives an array of `PlannerAssignment` rows and groups them by slot key into `CellState.lessons`:

```typescript
const weekState = new Map<string, CellState>()

// Seed defaults
for (const [key, groupId] of classDefaultsRef.current) {
  weekState.set(key, { groupId, lessons: [] })
}

// Group DB rows by slot
for (const pa of data) {
  const key = slotKey(pa.day as Day, pa.period)
  const existing = weekState.get(key) ?? { groupId: pa.group_id, lessons: [] }
  existing.lessons.push({
    lessonId: pa.lesson_id,
    unitId: pa.unit_id,
    assignmentId: pa.id,
    feedbackVisible: pa.feedback_visible,
    issueFlag: pa.issue_flag,
    issueNote: pa.issue_note,
    lessonNotes: pa.notes,
  })
  weekState.set(key, existing)
}
```

### Lesson change from cell (1-lesson swap)

`handleLessonChange` deletes the existing lesson (if any) then upserts the new one:

```typescript
const handleLessonChange = async (day, period, newLessonId) => {
  const cell = plannerState.get(slotKey(day, period)) ?? emptyCellState()
  const existing = cell.lessons[0] ?? null

  // Remove old lesson
  if (existing) {
    await deletePlannerAssignmentAction(cell.groupId, existing.lessonId, week, day, period)
    updateSlot(day, period, s => ({ ...s, lessons: [] }))
  }

  if (!newLessonId || !cell.groupId || cell.groupId === '__free__') return

  // Add new lesson
  const { data } = await upsertPlannerAssignmentAction(cell.groupId, newLessonId, week, day, period, {})
  if (data) {
    updateSlot(day, period, s => ({
      ...s,
      lessons: [{ lessonId: data.lesson_id, unitId: data.unit_id, assignmentId: data.id,
                   feedbackVisible: false, issueFlag: false, issueNote: '', lessonNotes: '' }]
    }))
  }
}
```

### Per-lesson extras (feedback, issue, notes)

`handleFeedbackToggle`, `handleIssueToggle`, `handleIssueNoteChange`, `handleLessonNotesChange` each accept an additional `lessonId` parameter so they target the correct `SlotLesson` in the array and the correct `planner_assignments` row.

---

## Section 6 — `/assignments` Page

The page becomes read-only. Remove all create/edit/delete UI from `AssignmentManager`. Display a table of scheduled lessons sourced from `readLessonAssignmentsAction` (which reads the view). Columns: group, lesson, unit, first scheduled date.

The old `/assignments` page UI components (`assignment-manager.tsx`, `assignment-grid.tsx`, `assignment-sidebar.tsx`) are simplified to display-only. The create assignment flow and group selector sidebar are removed.

---

## File Changes Summary

### New files
```
src/migrations/20260508_lesson_assignments_view.sql
```

### Modified files
```
src/migrations/20260508_lesson_assignments_view.sql     (new — schema change + migration + view)
src/components/teacher-planner/types.ts                 (SlotLesson, CellState, emptyCellState)
src/lib/server-actions/planner-assignments.ts           (deletePlannerAssignmentAction + lessonId)
src/lib/server-actions/lesson-assignments.ts            (delete 5 write actions)
src/lib/server-updates.ts                               (remove deleted exports)
src/components/teacher-planner/TeacherPlannerClient.tsx (loadWeekAssignments, handlers)
src/components/teacher-planner/PlannerGrid.tsx          (cell: 1 lesson vs "Lesson plan")
src/components/teacher-planner/SidePanel.tsx            (lesson list, add/remove UI)
src/app/assignments/page.tsx                            (read-only, remove write UI)
src/components/assignment-manager/assignment-manager.tsx (strip write controls)
src/components/assignment-manager/assignment-grid.tsx    (read-only display)
```

### Deleted write actions (from lesson-assignments.ts)
```
upsertLessonAssignmentAction
deleteLessonAssignmentAction
toggleLessonAssignmentVisibilityAction
toggleLessonAssignmentLockedAction
toggleLessonAssignmentFeedbackVisibilityAction
```

---

## Type Dependencies

`readPlannerAssignmentsForWeekAction` already returns `unit_id` via the existing `PlannerAssignmentWithUnit` type (from the foundation work). This field populates `SlotLesson.unitId` in `loadWeekAssignments`. No changes needed to the server action or its return type.

---

## Constraints

- `deletePlannerAssignmentAction` must always include `lesson_id` in its WHERE clause — never delete an entire slot blindly
- The migration `ON CONFLICT DO NOTHING` is safe to re-run
- Groups with no `timetable_slot_groups` entry are skipped in migration — no error, silent skip
- The view is read-only; all writes go through `planner_assignments` server actions only
- `checkLessonAccessForPupilAction` continues to work correctly — the view always returns `hidden=FALSE, locked=FALSE` so it always returns accessible
- `feedback_visible` on the view uses `BOOL_OR` — true if any slot for that group+lesson has feedback on
