# Planner-Driven Assignments Design

## Goal

Move lesson assignment from the standalone `/assignments` view into the weekly teacher planner. Assignments are created at the intersection of group × lesson × timetable period × week. Three reporting views — group/unit progress, week overview, and pupil progress — are rebuilt on top of this model. The existing `/assignments` path and its tables remain operational in parallel throughout the transition.

## Architecture

```
planner_assignments (new)
  group_id × lesson_id × week_start_date × day × period
       │
       ├── Group/Unit Progress report
       ├── Week Overview report
       └── Pupil Progress report (replaces old /reports/[pupilId])

timetable_slot_groups (new)
  teacher_id × day × period → group_id
  (persists the teacher's class-override state, replacing the in-memory classOverrides map)

assignments + lesson_assignments (existing — unchanged, parallel)
```

---

## Sub-project 1 — Foundation: Data Model + Planner Writes

### New table: `planner_assignments`

```sql
CREATE TABLE planner_assignments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         text        NOT NULL REFERENCES groups(group_id),
  lesson_id        text        NOT NULL REFERENCES lessons(lesson_id),
  week_start_date  date        NOT NULL,
  day              text        NOT NULL
                               CHECK (day IN ('sunday','monday','tuesday','wednesday','thursday')),
  period           integer     NOT NULL CHECK (period BETWEEN 1 AND 7),
  feedback_visible boolean     NOT NULL DEFAULT false,
  issue_flag       boolean     NOT NULL DEFAULT false,
  issue_note       text        NOT NULL DEFAULT '',
  notes            text        NOT NULL DEFAULT '',
  created_by       text        REFERENCES profiles(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, week_start_date, day, period)
);
```

One record per timetable slot per week. The unique constraint on `(group_id, week_start_date, day, period)` enforces that a slot can only have one lesson per week. A free period or an unassigned slot produces no record.

### New table: `timetable_slot_groups`

```sql
CREATE TABLE timetable_slot_groups (
  teacher_id  text     NOT NULL REFERENCES profiles(user_id),
  day         text     NOT NULL,
  period      integer  NOT NULL,
  group_id    text     REFERENCES groups(group_id),  -- NULL = free period
  PRIMARY KEY (teacher_id, day, period)
);
```

Stores which DB group the teacher has associated with each hardcoded timetable slot. Replaces the in-memory `classOverrides` Map in `TeacherPlannerClient`. Persists across sessions and weeks.

### Server actions — `src/lib/server-actions/planner-assignments.ts`

```ts
// Upsert a lesson assignment for a slot. Called when teacher selects a lesson in a cell.
upsertPlannerAssignmentAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,   // ISO "YYYY-MM-DD"
  day: string,
  period: number,
  extras?: { notes?: string; issueFlag?: boolean; issueNote?: string; feedbackVisible?: boolean }
): Promise<{ data: PlannerAssignment | null; error: string | null }>

// Delete a lesson assignment. Called when teacher clears a lesson or marks slot free.
deletePlannerAssignmentAction(
  groupId: string,
  weekStartDate: string,
  day: string,
  period: number
): Promise<{ data: null; error: string | null }>

// Load all assignments for a given week (for the current teacher's groups).
readPlannerAssignmentsForWeekAction(
  weekStartDate: string
): Promise<{ data: PlannerAssignment[] | null; error: string | null }>

// Update mutable fields on an existing assignment (notes, flags, feedback_visible).
updatePlannerAssignmentExtrasAction(
  id: string,
  patch: Partial<Pick<PlannerAssignment, 'notes' | 'issueFlag' | 'issueNote' | 'feedbackVisible'>>
): Promise<{ data: PlannerAssignment | null; error: string | null }>
```

### Server actions — `src/lib/server-actions/timetable-slot-groups.ts`

```ts
// Save the teacher's group assignment for a slot. Called when teacher picks a class override.
upsertTimetableSlotGroupAction(
  day: string,
  period: number,
  groupId: string | null   // null = free period
): Promise<{ data: null; error: string | null }>

// Load all slot-group mappings for the current teacher.
readTimetableSlotGroupsAction(): Promise<{ data: TimetableSlotGroup[] | null; error: string | null }>
```

### Planner UI changes

**`TeacherPlannerClient`** — on mount, call `readTimetableSlotGroupsAction()` and `readPlannerAssignmentsForWeekAction(currentWeek)` to hydrate from DB instead of starting empty.

**Auto-save triggers:**
| Action | DB write |
|---|---|
| Teacher selects a lesson (with group set) | `upsertPlannerAssignmentAction` |
| Teacher clears a lesson | `deletePlannerAssignmentAction` |
| Teacher marks slot free | `deletePlannerAssignmentAction` + `upsertTimetableSlotGroupAction(null)` |
| Teacher changes class (group) | `upsertTimetableSlotGroupAction` |
| Teacher changes notes / flags / feedback | `updatePlannerAssignmentExtrasAction` |

**Week navigation** — on navigating to a new week, call `readPlannerAssignmentsForWeekAction` for that week and merge into `weeklyStates`. Already-loaded weeks are served from cache.

**`src/types/index.ts`** — add `PlannerAssignmentSchema` and `TimetableSlotGroupSchema`:

```ts
export const PlannerAssignmentSchema = z.object({
  id:               z.string().uuid(),
  group_id:         z.string(),
  lesson_id:        z.string(),
  week_start_date:  z.string(),  // ISO date
  day:              z.string(),
  period:           z.number().int(),
  feedback_visible: z.boolean(),
  issue_flag:       z.boolean(),
  issue_note:       z.string(),
  notes:            z.string(),
  created_by:       z.string().nullable(),
  created_at:       z.string(),
  updated_at:       z.string(),
})
export type PlannerAssignment = z.infer<typeof PlannerAssignmentSchema>

export const TimetableSlotGroupSchema = z.object({
  teacher_id: z.string(),
  day:        z.string(),
  period:     z.number().int(),
  group_id:   z.string().nullable(),
})
export type TimetableSlotGroup = z.infer<typeof TimetableSlotGroupSchema>
```

### Migration file

`src/migrations/20260507_add_planner_assignments.sql` — creates both tables. No data migration from old tables; they coexist.

---

## Sub-project 2 — Group / Unit Progress Report

### Route

`/reports/groups/[groupId]` (replaces or extends existing group report)

### Data

New server action `readGroupUnitProgressAction(groupId)`:

```sql
SELECT
  u.unit_id, u.title AS unit_title, u.order_by AS unit_order,
  l.lesson_id, l.title AS lesson_title, l.order_by AS lesson_order,
  pa.week_start_date, pa.day, pa.period,
  pa.feedback_visible,
  -- avg submission score for this group × lesson
  AVG(compute_submission_base_score(s.body, a.activity_type)) AS avg_score,
  COUNT(s.submission_id) AS submission_count
FROM units u
JOIN lessons l ON l.unit_id = u.unit_id AND l.active
LEFT JOIN planner_assignments pa
       ON pa.lesson_id = l.lesson_id AND pa.group_id = $groupId
LEFT JOIN group_memberships gm ON gm.group_id = $groupId
LEFT JOIN activities a ON a.lesson_id = l.lesson_id
LEFT JOIN submissions s ON s.activity_id = a.activity_id AND s.user_id = gm.user_id
WHERE u.active
GROUP BY u.unit_id, u.title, u.order_by,
         l.lesson_id, l.title, l.order_by,
         pa.week_start_date, pa.day, pa.period, pa.feedback_visible
ORDER BY u.order_by, l.order_by, pa.week_start_date
```

Returns lessons grouped by unit with:
- When taught (`week_start_date`, `day`, `period`) — null if not yet taught
- Average submission score across all group members
- Submission count

### Display

- Units as section headers
- Lessons as rows: title | week taught | period | avg score
- "Not yet taught" row style for lessons with null `week_start_date`
- Unit-level aggregate score (average of taught lesson averages)
- Coverage bar: N of M lessons taught

---

## Sub-project 3 — Week Overview Report

### Route

Accessible from the planner header as a "Week summary" panel (toggle), or at `/planner/week/[weekKey]`. Recommend the toggle panel approach — keeps context without a page navigation.

### Data

Reuse `readPlannerAssignmentsForWeekAction` (already loaded). No additional DB call needed when the teacher is already on the planner page.

### Display

- Grouped by day, then period
- Each assignment row: period label | group | lesson title | feedback indicator | issue flag
- Free/empty slots shown dimmed
- Summary footer: N lessons assigned, N with feedback visible, N issues flagged
- Issue notes expandable inline

---

## Sub-project 4 — Pupil Progress Report

### Route

`/reports/[pupilId]` — rebuild the existing view to use `planner_assignments` as the data source

### Data

New server action `readPupilProgressAction(pupilId)`. Replaces `readPupilLessonsDetailBootstrapAction` for the new path.

```sql
-- Get the pupil's groups
WITH pupil_groups AS (
  SELECT gm.group_id FROM group_memberships gm WHERE gm.user_id = $pupilId
),
-- Get all lessons taught to any of their groups, with timing
taught_lessons AS (
  SELECT pa.lesson_id, pa.group_id,
         pa.week_start_date, pa.day, pa.period
  FROM planner_assignments pa
  JOIN pupil_groups pg ON pg.group_id = pa.group_id
),
-- Get submissions for those lessons
lesson_scores AS (
  SELECT s.lesson_id,
         compute_submission_base_score(s.body, a.activity_type) AS score
  FROM submissions s
  JOIN activities a ON a.activity_id = s.activity_id
  WHERE s.user_id = $pupilId
)
SELECT
  u.unit_id, u.title AS unit_title, u.order_by AS unit_order,
  l.lesson_id, l.title AS lesson_title, l.order_by AS lesson_order,
  tl.week_start_date, tl.day, tl.period,
  AVG(ls.score) AS lesson_score
FROM units u
JOIN lessons l ON l.unit_id = u.unit_id AND l.active
LEFT JOIN taught_lessons tl ON tl.lesson_id = l.lesson_id
LEFT JOIN lesson_scores ls ON ls.lesson_id = l.lesson_id
WHERE u.active
GROUP BY u.unit_id, u.title, u.order_by,
         l.lesson_id, l.title, l.order_by,
         tl.week_start_date, tl.day, tl.period
ORDER BY u.order_by, l.order_by
```

### Display

- Same structure as current `/reports/[pupilId]` but sourced from `planner_assignments`
- Untaught lessons shown greyed out ("not yet taught by your teacher")
- Unit-level progress bar
- Individual lesson scores
- Date context (week taught) shown alongside score

---

## File Structure

### New files
```
src/lib/server-actions/planner-assignments.ts
src/lib/server-actions/timetable-slot-groups.ts
src/migrations/20260507_add_planner_assignments.sql
src/app/reports/groups/[groupId]/page.tsx         (new or replace)
src/app/reports/groups/[groupId]/group-progress.tsx
```

### Modified files
```
src/types/index.ts                                 add PlannerAssignment, TimetableSlotGroup schemas
src/lib/server-updates.ts                          re-export new actions
src/components/teacher-planner/TeacherPlannerClient.tsx   DB hydration + auto-save
src/app/reports/[pupilId]/page.tsx                 switch data source
src/app/reports/[pupilId]/report-data.ts           add readPupilProgressAction path
```

### Unchanged (parallel operation)
```
src/app/assignments/            untouched
src/lib/server-actions/assignments.ts   untouched
assignments table               untouched
lesson_assignments table        untouched
```

---

## Constraints

- All server actions use `requireAuthenticatedProfile()` or `requireRole('teacher')`
- `updated_at` on `planner_assignments` updated via trigger or explicit SET in upsert
- `week_start_date` must always be a Sunday (validated in server action, not DB constraint)
- Upsert on `planner_assignments` uses `ON CONFLICT (group_id, week_start_date, day, period) DO UPDATE SET lesson_id = EXCLUDED.lesson_id, updated_at = now()`
- No unit_id stored directly on `planner_assignments` — always derived via `lessons.unit_id`

## Implementation Order

1. Sub-project 1 (foundation) — must land first
2. Sub-projects 2, 3, 4 — independent of each other, any order
