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
       ├── PlannerGrid cells  (1 lesson → unit+lesson dropdowns; 2+ lessons → "Lesson plan (N)")
       └── SidePanel          (list all lessons per slot; add / remove / swap individual lessons)

planner_period_flags  (period-level warning flags — independent of lesson assignment)
       │
       └── CellState.issueFlag / issueNote  (loaded alongside assignments each week)
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

### `planner_period_flags` table (new)

Stores period-level warning flags that are independent of whether any lesson is assigned to the slot. A teacher can flag a period before or after assigning lessons.

```sql
CREATE TABLE IF NOT EXISTS planner_period_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  day             text NOT NULL,
  period          integer NOT NULL,
  issue_flag      boolean NOT NULL DEFAULT false,
  issue_note      text NOT NULL DEFAULT '',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (teacher_id, week_start_date, day, period)
);
```

### `CellState` type (TypeScript)

`issueFlag` and `issueNote` live at the period level (on `CellState`), not on individual lessons. `SlotLesson` contains only lesson-scoped data.

```typescript
// src/components/teacher-planner/types.ts

export type SlotLesson = {
  lessonId: string
  unitId: string
  lessonTitle: string
  assignmentId: string
  feedbackVisible: boolean
  lessonNotes: string
}

export type CellState = {
  groupId: string | null
  lessons: SlotLesson[]    // empty array = no lessons assigned to this slot
  issueFlag: boolean       // period-level warning flag
  issueNote: string        // period-level warning note
}
```

`emptyCellState()` returns `{ groupId: null, lessons: [], issueFlag: false, issueNote: '' }`.

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
| 1 lesson | unit + lesson dropdowns pre-filled | Lesson swappable; unit always changeable |
| 2+ lessons | "Lesson plan (N)" | Dropdowns hidden — manage via side panel |

The unit dropdown is **always editable** when the slot has 0 or 1 lesson, even after a lesson has been assigned. Changing the unit in this state updates the lesson dropdown options but does not remove the existing lesson until a new lesson is selected.

When the teacher picks a different lesson from the cell (0 or 1-lesson state): delete the existing `planner_assignments` row for the old lesson (if any), insert a new one for the new lesson.

### Unit and lesson filtering

Units displayed in all dropdowns (cell and side panel) are filtered to:
- `unit.subject === group.subject` — only units matching the class's subject
- `unit.active !== false` — only active units

Lessons displayed in all dropdowns are filtered to:
- `lesson.active = true` — only active lessons (enforced in `readLessonsByUnitAction` SQL)

### Period warning flag

The warning flag is attached to the **period**, not to any individual lesson. Teachers can flag a period before or after lessons are assigned. The flag and note are stored in `planner_period_flags` and loaded alongside assignments when a week is fetched.

- Flag state controls cell background (red tint) and icon tint
- When the flag is toggled off, the note is cleared
- The side panel always shows the period warning section, regardless of whether a lesson is assigned

### Side panel — multiple lesson management

When a slot has lessons, the side panel shows a lesson list. Each lesson card displays:
- Lesson title
- Unit + lesson swap dropdowns (allows changing either independently)
- Feedback visible toggle
- `%` grades link → `/results/assignments/{groupId}__{lessonId}` (double underscore separator)
- Remove button (deletes that specific `planner_assignments` row)

An **Add lesson** section at the bottom of the list provides unit + lesson dropdowns to add a further lesson to the slot. This calls `upsertPlannerAssignmentAction` with the slot coordinates and the new `lessonId`.

The side panel shows the lesson list regardless of whether the slot has 1 or multiple lessons — it is always the place to manage extras and per-lesson flags.

### Grades icon (`%`)

In the cell icon row (shown when a group + at least one lesson is assigned), the `%` icon is a `<Link>` to `/results/assignments/{groupId}__{lessonId}` where `lessonId` is `lessons[0].lessonId`. In the side panel `LessonCard`, each lesson has its own `%` link using that lesson's `lessonId`.

---

## Section 3 — Migration

### Migration files

Two migration files, run in order:

1. `src/migrations/20260508_lesson_assignments_view.sql`
2. `src/migrations/20260508_planner_period_flags.sql`

### `20260508_lesson_assignments_view.sql`

**Step 1:** Seed `timetable_slot_groups` for the production teacher (`leroysalih@bisak.org`). Uses `ON CONFLICT DO NOTHING` — safe to re-run; will not overwrite teacher's own changes.

**Step 2:** Replace the UNIQUE constraint on `planner_assignments`.

**Step 3:** Migrate existing `lesson_assignments` rows into `planner_assignments`. Uses `LEFT JOIN` with `COALESCE` fallback to `sunday`/period `1` so no records are silently dropped when a group has no timetable entry.

```sql
INSERT INTO planner_assignments (group_id, lesson_id, week_start_date, day, period)
SELECT
  la.group_id,
  la.lesson_id,
  (la.start_date - EXTRACT(DOW FROM la.start_date)::int * INTERVAL '1 day')::date AS week_start_date,
  COALESCE(first_slot.day,    'sunday') AS day,
  COALESCE(first_slot.period, 1)        AS period
FROM lesson_assignments la
LEFT JOIN (
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
      ELSE 5
    END,
    period
) first_slot ON first_slot.group_id = la.group_id
ON CONFLICT DO NOTHING;
```

**Step 4:** Drop the `lesson_assignments` table and create the view.

### `20260508_planner_period_flags.sql`

Creates the `planner_period_flags` table. Safe to re-run (`CREATE TABLE IF NOT EXISTS`).

---

## Section 4 — Server Action Changes

### `src/lib/server-actions/planner-assignments.ts`

`deletePlannerAssignmentAction` signature includes `lessonId`:
```typescript
deletePlannerAssignmentAction(groupId, lessonId, weekStartDate, day, period)
```

The SQL `WHERE` clause includes `AND lesson_id = $lessonId` so only the targeted lesson is removed.

`readPlannerAssignmentsForWeekAction` returns all rows for the week. The client groups them by slot key when building `weeklyStates`. The return type `PlannerAssignmentWithUnit` includes `unit_id`, `lesson_title`, `notes`, `feedback_visible`, `issue_flag`, `issue_note`.

### `src/lib/server-actions/planner-period-flags.ts` (new)

```typescript
readPlannerPeriodFlagsForWeekAction(weekStartDate: string)
// Returns: { data: Array<{ day, period, issue_flag, issue_note }>, error }

upsertPlannerPeriodFlagAction(weekStartDate, day, period, issueFlag, issueNote)
// Upserts into planner_period_flags; returns { data, error }
```

### `src/lib/server-actions/lessons.ts`

`readLessonsByUnitAction` filters to active lessons only:
```sql
WHERE l.unit_id = $1 AND l.active = true
```

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

Remove exports of the five deleted write actions above. Add exports for `readPlannerPeriodFlagsForWeekAction` and `upsertPlannerPeriodFlagAction`.

---

## Section 5 — TeacherPlannerClient Changes

### Loading week assignments

`loadWeekAssignments` fetches both planner assignments and period flags in parallel, then merges them into `CellState`:

```typescript
const [assignmentsResult, flagsResult] = await Promise.all([
  readPlannerAssignmentsForWeekAction(week),
  readPlannerPeriodFlagsForWeekAction(week),
])

const flagsByKey = new Map<string, { issueFlag: boolean; issueNote: string }>()
for (const f of flagsResult.data ?? []) {
  flagsByKey.set(slotKey(f.day as Day, f.period), { issueFlag: f.issue_flag, issueNote: f.issue_note })
}

// Seed defaults
for (const [key, groupId] of classDefaultsRef.current) {
  const flag = flagsByKey.get(key) ?? { issueFlag: false, issueNote: '' }
  weekState.set(key, { groupId, lessons: [], ...flag })
}

// Group DB rows by slot
for (const pa of assignmentsResult.data) {
  const key = slotKey(pa.day as Day, pa.period)
  const flag = flagsByKey.get(key) ?? { issueFlag: false, issueNote: '' }
  const existing = weekState.get(key) ?? { groupId: pa.group_id, lessons: [], ...flag }
  existing.lessons.push({
    lessonId: pa.lesson_id,
    unitId: pa.unit_id,
    lessonTitle: pa.lesson_title,
    assignmentId: pa.id,
    feedbackVisible: pa.feedback_visible,
    lessonNotes: pa.notes,
  })
  weekState.set(key, existing)
}
```

### Period flag handlers

```typescript
handleIssueToggle(day, period)          // no lessonId — period-level
handleIssueNoteChange(day, period, note) // no lessonId — period-level
```

Both call `upsertPlannerPeriodFlagAction`.

### Lesson change from cell (1-lesson swap)

`handleLessonChange` deletes the existing lesson (if any) then upserts the new one. `handleAddLesson`, `handleRemoveLesson`, `handleSwapLesson` handle multi-lesson operations via the side panel.

### `PlannerGrid` — unit filtering per cell

`PlannerGrid` receives `groups: Group[]` and builds a `groupSubjectMap`. Each `PlannerCell` receives `units` filtered to `unit.subject === groupSubject && unit.active !== false`.

---

## Section 6 — `/assignments` Page

The page becomes read-only. Remove all create/edit/delete UI from `AssignmentManager`. Display a table of scheduled lessons sourced from `readLessonAssignmentsAction` (which reads the view). Columns: group, lesson, unit, first scheduled date.

---

## Section 7 — Root Redirect

`src/app/page.tsx` redirects authenticated teachers directly to `/teacher-planner` instead of showing the old progress dashboard.

---

## File Changes Summary

### New files
```
src/migrations/20260508_lesson_assignments_view.sql
src/migrations/20260508_planner_period_flags.sql
src/lib/server-actions/planner-period-flags.ts
src/components/teacher-planner/WeekNavigator.tsx
```

### Modified files
```
src/components/teacher-planner/types.ts                 (SlotLesson, CellState, emptyCellState)
src/lib/server-actions/planner-assignments.ts           (deletePlannerAssignmentAction + lessonId)
src/lib/server-actions/lesson-assignments.ts            (delete 5 write actions)
src/lib/server-actions/lessons.ts                       (active=true filter)
src/lib/server-updates.ts                               (remove deleted exports, add period flags)
src/components/teacher-planner/TeacherPlannerClient.tsx (loadWeekAssignments, handlers)
src/components/teacher-planner/PlannerGrid.tsx          (groups prop, per-cell unit filtering)
src/components/teacher-planner/PlannerCell.tsx          (unit always editable, % link, 2+ label)
src/components/teacher-planner/SidePanel.tsx            (period warning, lesson cards, % links)
src/app/page.tsx                                        (redirect to /teacher-planner)
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

`readPlannerAssignmentsForWeekAction` returns `PlannerAssignmentWithUnit` rows that include `unit_id`, `lesson_title`, `notes`, `feedback_visible`. These populate `SlotLesson` fields in `loadWeekAssignments`.

---

## Constraints

- `deletePlannerAssignmentAction` must always include `lesson_id` in its WHERE clause — never delete an entire slot blindly
- The migration `ON CONFLICT DO NOTHING` is safe to re-run
- Migration uses `LEFT JOIN` + `COALESCE` fallback so no records are lost for groups without a timetable entry
- Production teacher email is `leroysalih@bisak.org` — used in Step 1 of the migration
- The view is read-only; all writes go through `planner_assignments` server actions only
- `checkLessonAccessForPupilAction` continues to work correctly — the view always returns `hidden=FALSE, locked=FALSE`
- `feedback_visible` on the view uses `BOOL_OR` — true if any slot for that group+lesson has feedback on
- Warning flags are period-scoped, not lesson-scoped — toggling a flag off clears the note
- Unit dropdowns always show only units matching the group's subject and `active !== false`
- Lesson dropdowns always show only lessons where `active = true`
- The `%` grades icon links to `/results/assignments/{groupId}__{lessonId}` (double underscore)
- `WeekNavigator` must be explicitly staged with `git add` before committing — it is a new file and will not be included in a merge if untracked
