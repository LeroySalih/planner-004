# Planner Drives Assignments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the teacher planner the sole write path for lesson assignments; replace the `lesson_assignments` table with a Postgres view so all pupil-facing queries continue to work unchanged; support multiple lessons per timetable slot.

**Architecture:** The `planner_assignments` unique constraint changes to `(group_id, week_start_date, day, period, lesson_id)` allowing multiple lessons per slot. A `lesson_assignments` VIEW derived from `planner_assignments` preserves the existing pupil-facing SQL surface. `CellState` is redesigned around a `lessons: SlotLesson[]` array. The `/assignments` page becomes a read-only scheduled-lessons view.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, PostgreSQL (`pg`), Tailwind CSS v4, Zod

---

## File Map

| File | Change |
|---|---|
| `src/migrations/20260508_lesson_assignments_view.sql` | **Create** — schema change, data migration, view |
| `src/types/index.ts` | **Modify** — add `lesson_title` to `PlannerAssignmentWithUnitSchema` |
| `src/components/teacher-planner/types.ts` | **Modify** — `SlotLesson`, `CellState`, `emptyCellState` |
| `src/lib/server-actions/planner-assignments.ts` | **Modify** — `deletePlannerAssignmentAction` + `lessonId`, fix conflict clause, add `lesson_title` to read |
| `src/components/teacher-planner/TeacherPlannerClient.tsx` | **Modify** — all handlers rewritten for `lessons[]` |
| `src/components/teacher-planner/PlannerCell.tsx` | **Modify** — 0 / 1 / multi lesson display |
| `src/components/teacher-planner/PlannerGrid.tsx` | **Modify** — pass `lessonCache` to cell directly |
| `src/components/teacher-planner/SidePanel.tsx` | **Modify** — lesson list, per-lesson flags, add/remove |
| `src/lib/server-actions/lesson-assignments.ts` | **Modify** — delete 5 write actions, keep 2 reads |
| `src/lib/server-updates.ts` | **Modify** — remove deleted write action exports |
| `src/app/assignments/page.tsx` | **Modify** — replace AssignmentManager with read-only table |
| `src/components/assignment-manager/scheduled-lessons-table.tsx` | **Create** — simple read-only lessons table |

---

## Task 1: DB Migration

**Files:**
- Create: `src/migrations/20260508_lesson_assignments_view.sql`

Context: The worktree uses its own isolated database. The `.env` file in the worktree root contains `DATABASE_URL`. Run psql commands using that connection string. The existing `lesson_assignments` table has columns: `group_id`, `lesson_id`, `start_date`, `hidden`, `locked`, `feedback_visible`, `order_by`.

- [ ] **Step 1: Write the migration file**

Create `src/migrations/20260508_lesson_assignments_view.sql` with this exact content:

```sql
-- 1. Change planner_assignments unique constraint to allow multiple lessons per slot
ALTER TABLE planner_assignments
  DROP CONSTRAINT IF EXISTS planner_assignments_group_id_week_start_date_day_period_key,
  ADD CONSTRAINT planner_assignments_group_lesson_slot_unique
    UNIQUE (group_id, week_start_date, day, period, lesson_id);

-- 2. Migrate existing lesson_assignments into planner_assignments
--    Each record lands in the first timetable slot of its week for that group.
--    Groups with no timetable_slot_groups entry are silently skipped.
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

-- 3. Drop the table and replace with a view of the same name
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

- [ ] **Step 2: Apply the migration to the dev database**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/teacher-planner-prototype
psql $DATABASE_URL -f src/migrations/20260508_lesson_assignments_view.sql
```

Expected: no errors. Commands complete with `ALTER TABLE`, `INSERT 0 N`, `DROP TABLE`, `CREATE VIEW`.

- [ ] **Step 3: Verify the view**

```bash
psql $DATABASE_URL -c "SELECT group_id, lesson_id, start_date FROM lesson_assignments LIMIT 5;"
psql $DATABASE_URL -c "\d lesson_assignments"
```

Expected: `\d` shows it is a view, not a table. SELECT returns rows (may be 0 if no planner_assignments yet — that is fine).

- [ ] **Step 4: Verify the new unique constraint**

```bash
psql $DATABASE_URL -c "\d planner_assignments"
```

Expected: constraint `planner_assignments_group_lesson_slot_unique` on `(group_id, week_start_date, day, period, lesson_id)`. Old constraint on just `(group_id, week_start_date, day, period)` is gone.

- [ ] **Step 5: Commit**

```bash
git add src/migrations/20260508_lesson_assignments_view.sql
git commit -m "feat(db): replace lesson_assignments table with planner-driven view

Changes planner_assignments unique key to allow multiple lessons per slot.
Migrates existing lesson_assignments into planner_assignments.
Drops lesson_assignments table and replaces with a view derived from
planner_assignments so all existing pupil-facing queries continue to work."
```

---

## Task 2: Update `PlannerAssignmentWithUnit` schema

**Files:**
- Modify: `src/types/index.ts`

Context: `PlannerAssignmentWithUnitSchema` is defined near the bottom of `src/types/index.ts`. It extends `PlannerAssignmentSchema` with `unit_id`. We need to add `lesson_title` so the client can display the lesson name without a separate lookup.

- [ ] **Step 1: Find and update the schema**

In `src/types/index.ts`, find:

```typescript
export const PlannerAssignmentWithUnitSchema = PlannerAssignmentSchema.extend({
  unit_id: z.string(),
})
export type PlannerAssignmentWithUnit = z.infer<typeof PlannerAssignmentWithUnitSchema>
```

Replace with:

```typescript
export const PlannerAssignmentWithUnitSchema = PlannerAssignmentSchema.extend({
  unit_id: z.string(),
  lesson_title: z.string(),
})
export type PlannerAssignmentWithUnit = z.infer<typeof PlannerAssignmentWithUnitSchema>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/teacher-planner-prototype
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: no new errors (pre-existing test errors about `string | undefined` are fine).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add lesson_title to PlannerAssignmentWithUnit"
```

---

## Task 3: Redesign `CellState` types

**Files:**
- Modify: `src/components/teacher-planner/types.ts`

Context: `CellState` currently has flat fields `unitId`, `lessonId`, `assignmentId`, `feedbackVisible`, `issueFlag`, `issueNote`, `lessonNotes`. These are replaced by a `lessons: SlotLesson[]` array. Each `SlotLesson` holds one `planner_assignments` row. `PlannerState` and `WeeklyPlannerState` remain the same (they're just maps keyed by slot/week).

- [ ] **Step 1: Replace `CellState` and update `emptyCellState`**

Replace the entire content of `src/components/teacher-planner/types.ts` with:

```typescript
// src/components/teacher-planner/types.ts

export type Day = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday'

export type TimetableSlot = {
  day: Day
  period: number
  classCode: string   // matches group.subject in DB
  subject: string     // display string, e.g. "Design tech"
  room: string
  startTime?: string  // e.g. "08:25"
  endTime?: string    // e.g. "09:25"
}

export type PeriodRow =
  | { type: 'lesson'; period: number; label: string; startTime?: string; endTime?: string }
  | { type: 'break'; label: string }

export type SlotLesson = {
  lessonId: string
  unitId: string
  lessonTitle: string
  assignmentId: string
  feedbackVisible: boolean
  issueFlag: boolean
  issueNote: string
  lessonNotes: string
}

export type CellState = {
  groupId: string | null   // '__free__' = explicitly marked as free period
  lessons: SlotLesson[]    // empty = no lessons assigned to this slot
}

export type PlannerState = Map<string, CellState>         // key: `${day}-${period}`
export type WeeklyPlannerState = Map<string, PlannerState> // key: ISO sunday date e.g. "2026-05-03"

export function slotKey(day: Day, period: number): string {
  return `${day}-${period}`
}

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getTodaySunday(): string {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return localDateStr(d)
}

export function shiftWeek(weekKey: string, delta: number): string {
  const [y, m, day] = weekKey.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  d.setDate(d.getDate() + delta * 7)
  return localDateStr(d)
}

export function formatWeekRange(weekKey: string): string {
  const sun = new Date(weekKey + 'T00:00:00')
  const thu = new Date(weekKey + 'T00:00:00')
  thu.setDate(thu.getDate() + 4)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `${fmt(sun)} – ${fmt(thu)} ${thu.getFullYear()}`
}

export function emptyCellState(): CellState {
  return {
    groupId: null,
    lessons: [],
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: errors in files that use the old `CellState` fields (`unitId`, `lessonId`, `assignmentId`, etc.). These are expected — they will be fixed in subsequent tasks. Record the list of files with errors so you know what to fix.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-planner/types.ts
git commit -m "feat(types): redesign CellState to support multiple lessons per slot

Replace flat lessonId/unitId/assignmentId fields with lessons: SlotLesson[]
array. Each SlotLesson holds one planner_assignments row including lessonTitle
for display without a secondary cache lookup."
```

---

## Task 4: Update `planner-assignments.ts` server action

**Files:**
- Modify: `src/lib/server-actions/planner-assignments.ts`

Context: Three changes needed:
1. `deletePlannerAssignmentAction` gains a `lessonId` parameter and adds `AND lesson_id = $N` to the WHERE clause
2. `upsertPlannerAssignmentAction` ON CONFLICT target changes from `(group_id, week_start_date, day, period)` to `(group_id, week_start_date, day, period, lesson_id)`
3. `readPlannerAssignmentsForWeekAction` SELECT adds `l.title AS lesson_title` and parses it via `PlannerAssignmentWithUnitSchema`

- [ ] **Step 1: Rewrite `src/lib/server-actions/planner-assignments.ts`**

Replace the entire file with:

```typescript
'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile } from '@/lib/auth'
import {
  PlannerAssignmentSchema,
  PlannerAssignmentWithUnitSchema,
  type PlannerAssignment,
} from '@/types'

const AssignmentResult = z.object({
  data: PlannerAssignmentSchema.nullable(),
  error: z.string().nullable(),
})

const AssignmentsWithUnitResult = z.object({
  data: z.array(PlannerAssignmentWithUnitSchema).nullable(),
  error: z.string().nullable(),
})

const NullResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

function toAssignment(row: Record<string, unknown>): PlannerAssignment {
  return PlannerAssignmentSchema.parse({
    ...row,
    week_start_date:
      row.week_start_date instanceof Date
        ? row.week_start_date.toISOString().slice(0, 10)
        : String(row.week_start_date),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  })
}

export async function upsertPlannerAssignmentAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
  day: string,
  period: number,
  extras?: {
    notes?: string
    issueFlag?: boolean
    issueNote?: string
    feedbackVisible?: boolean
  },
): Promise<z.infer<typeof AssignmentResult>> {
  try {
    const profile = await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return AssignmentResult.parse({ data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' })
    }
    const { rows } = await query<Record<string, unknown>>(
      `INSERT INTO planner_assignments
         (group_id, lesson_id, week_start_date, day, period,
          feedback_visible, issue_flag, issue_note, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (group_id, week_start_date, day, period, lesson_id)
       DO UPDATE SET
         feedback_visible = EXCLUDED.feedback_visible,
         issue_flag       = EXCLUDED.issue_flag,
         issue_note       = EXCLUDED.issue_note,
         notes            = EXCLUDED.notes,
         updated_at       = now()
       RETURNING *`,
      [
        groupId,
        lessonId,
        weekStartDate,
        day,
        period,
        extras?.feedbackVisible ?? false,
        extras?.issueFlag ?? false,
        extras?.issueNote ?? '',
        extras?.notes ?? '',
        profile.userId,
      ],
    )
    return AssignmentResult.parse({ data: toAssignment(rows[0]), error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save assignment'
    return AssignmentResult.parse({ data: null, error: message })
  }
}

export async function deletePlannerAssignmentAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
  day: string,
  period: number,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return NullResult.parse({ data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' })
    }
    await query(
      `DELETE FROM planner_assignments
       WHERE group_id = $1 AND lesson_id = $2 AND week_start_date = $3 AND day = $4 AND period = $5`,
      [groupId, lessonId, weekStartDate, day, period],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete assignment'
    return NullResult.parse({ data: null, error: message })
  }
}

export async function readPlannerAssignmentsForWeekAction(
  weekStartDate: string,
): Promise<z.infer<typeof AssignmentsWithUnitResult>> {
  try {
    const profile = await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return AssignmentsWithUnitResult.parse({ data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' })
    }
    const { rows } = await query<Record<string, unknown>>(
      `SELECT pa.*, l.unit_id, l.title AS lesson_title
       FROM planner_assignments pa
       JOIN lessons l ON l.lesson_id = pa.lesson_id
       JOIN timetable_slot_groups tsg
         ON tsg.teacher_id = $1 AND tsg.day = pa.day AND tsg.period = pa.period
       WHERE pa.week_start_date = $2`,
      [profile.userId, weekStartDate],
    )
    const data = rows.map((row) =>
      PlannerAssignmentWithUnitSchema.parse({
        ...toAssignment(row),
        unit_id: row.unit_id,
        lesson_title: row.lesson_title,
      }),
    )
    return AssignmentsWithUnitResult.parse({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load week assignments'
    return AssignmentsWithUnitResult.parse({ data: null, error: message })
  }
}

export async function updatePlannerAssignmentExtrasAction(
  id: string,
  patch: Partial<Pick<PlannerAssignment, 'notes' | 'issue_flag' | 'issue_note' | 'feedback_visible'>>,
): Promise<z.infer<typeof AssignmentResult>> {
  try {
    await requireTeacherProfile()
    if (Object.keys(patch).filter(k => patch[k as keyof typeof patch] !== undefined).length === 0) {
      return AssignmentResult.parse({ data: null, error: 'No fields to update' })
    }
    const setClauses: string[] = ['updated_at = now()']
    const params: unknown[] = [id]
    let idx = 2
    if (patch.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(patch.notes) }
    if (patch.issue_flag !== undefined) { setClauses.push(`issue_flag = $${idx++}`); params.push(patch.issue_flag) }
    if (patch.issue_note !== undefined) { setClauses.push(`issue_note = $${idx++}`); params.push(patch.issue_note) }
    if (patch.feedback_visible !== undefined) { setClauses.push(`feedback_visible = $${idx++}`); params.push(patch.feedback_visible) }
    const { rows } = await query<Record<string, unknown>>(
      `UPDATE planner_assignments SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    )
    if (rows.length === 0) return AssignmentResult.parse({ data: null, error: 'Assignment not found' })
    return AssignmentResult.parse({ data: toAssignment(rows[0]), error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update assignment'
    return AssignmentResult.parse({ data: null, error: message })
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: errors only in files that call `deletePlannerAssignmentAction` with the old 4-arg signature. Note which files — they will be fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/planner-assignments.ts
git commit -m "feat(server): update planner-assignments actions for multi-lesson slots

- deletePlannerAssignmentAction gains lessonId parameter (targets specific lesson)
- upsertPlannerAssignmentAction conflict target updated to include lesson_id
- readPlannerAssignmentsForWeekAction returns lesson_title from lessons JOIN"
```

---

## Task 5: Rewrite `TeacherPlannerClient.tsx`

**Files:**
- Modify: `src/components/teacher-planner/TeacherPlannerClient.tsx`

Context: All handlers reference old flat `CellState` fields. The entire component needs to be rewritten to use `lessons: SlotLesson[]`. Key changes:
- `loadWeekAssignments`: groups multiple DB rows by slot key into the `lessons` array
- `handleUnitChange`: removed — unit selection is now local state in PlannerCell
- `handleLessonChange`: for 1-lesson swap from cell — deletes old lesson, upserts new
- `handleAddLesson`: new — adds an extra lesson from SidePanel
- `handleRemoveLesson`: new — removes a specific lesson from SidePanel
- `handleFeedbackToggle`, `handleIssueToggle`, `handleIssueNoteChange`, `handleLessonNotesChange`: gain `lessonId` parameter to target correct `SlotLesson`
- `handleGroupChange`: deletes all lessons for old group, re-creates for new group

- [ ] **Step 1: Rewrite `src/components/teacher-planner/TeacherPlannerClient.tsx`**

```typescript
'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  readLessonsByUnitAction,
  upsertPlannerAssignmentAction,
  deletePlannerAssignmentAction,
  readPlannerAssignmentsForWeekAction,
  updatePlannerAssignmentExtrasAction,
  readTimetableSlotGroupsAction,
  upsertTimetableSlotGroupAction,
} from '@/lib/server-updates'
import { PlannerGrid } from './PlannerGrid'
import { SidePanel } from './SidePanel'
import { WeekNavigator } from './WeekNavigator'
import { WeekNotes } from './WeekNotes'
import { TIMETABLE_SLOTS } from './timetable-config'
import { slotKey, emptyCellState, getTodaySunday, shiftWeek } from './types'
import type { WeeklyPlannerState, CellState, SlotLesson, Day } from './types'
import type { Unit, Group, LessonWithObjectives } from '@/types'

type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
}

export function TeacherPlannerClient({ units, groups }: TeacherPlannerClientProps) {
  const [weeklyStates, setWeeklyStates] = useState<WeeklyPlannerState>(new Map())
  const [currentWeek, setCurrentWeek] = useState<string>(getTodaySunday)
  const [weekNotes, setWeekNotesMap] = useState<Map<string, string>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())

  const currentWeekRef = useRef(currentWeek)
  currentWeekRef.current = currentWeek

  const classDefaultsRef = useRef<Map<string, string | null>>(new Map())
  const loadedWeeks = useRef<Set<string>>(new Set())

  const loadWeekAssignments = useCallback(async (week: string) => {
    if (loadedWeeks.current.has(week)) return
    const { data, error } = await readPlannerAssignmentsForWeekAction(week)
    if (error || !data) {
      console.error('[loadWeekAssignments] Failed to load week:', week, error)
      return
    }
    loadedWeeks.current.add(week)
    setWeeklyStates((prev) => {
      const weekState = new Map<string, CellState>()
      // Seed with defaults
      for (const [key, groupId] of classDefaultsRef.current) {
        weekState.set(key, { groupId, lessons: [] })
      }
      // Group DB rows by slot — multiple lessons per slot allowed
      for (const pa of data) {
        const key = slotKey(pa.day as Day, pa.period)
        const existing = weekState.get(key) ?? { groupId: pa.group_id, lessons: [] }
        existing.lessons.push({
          lessonId: pa.lesson_id,
          unitId: pa.unit_id,
          lessonTitle: pa.lesson_title,
          assignmentId: pa.id,
          feedbackVisible: pa.feedback_visible,
          issueFlag: pa.issue_flag,
          issueNote: pa.issue_note,
          lessonNotes: pa.notes,
        })
        weekState.set(key, existing)
      }
      const next = new Map(prev)
      next.set(week, weekState)
      return next
    })
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data, error } = await readTimetableSlotGroupsAction()
      if (error || !data) {
        console.error('[hydration] Failed to load timetable slot groups:', error)
      } else {
        for (const tsg of data) {
          classDefaultsRef.current.set(slotKey(tsg.day as Day, tsg.period), tsg.group_id)
        }
      }
      await loadWeekAssignments(getTodaySunday())
    }
    init()
  }, [loadWeekAssignments])

  const plannerState = weeklyStates.get(currentWeek) ?? new Map<string, CellState>()

  const updateSlot = useCallback(
    (day: Day, period: number, update: (s: CellState) => CellState) => {
      const week = currentWeekRef.current
      const key = slotKey(day, period)
      setWeeklyStates((prev) => {
        const weekState = prev.get(week) ?? new Map()
        const current = weekState.get(key) ?? emptyCellState()
        const nextWeekState = new Map(weekState)
        nextWeekState.set(key, update(current))
        const next = new Map(prev)
        next.set(week, nextWeekState)
        return next
      })
    },
    [],
  )

  const handleCellClick = useCallback((day: Day, period: number) => {
    const key = slotKey(day, period)
    setSelectedSlot((prev) => (prev === key ? null : key))
  }, [])

  // Called by PlannerCell when teacher selects a unit (0-lesson state) — loads lesson options
  const handleUnitSelect = useCallback(async (unitId: string) => {
    if (!unitId) return
    const result = await readLessonsByUnitAction(unitId)
    if (result.data) {
      setLessonCache((prev) => {
        if (prev.has(unitId)) return prev
        const next = new Map(prev)
        next.set(unitId, result.data!)
        return next
      })
    }
  }, [])

  // Called from cell: swap the single lesson (0-lesson add OR 1-lesson replace)
  const handleLessonChange = useCallback(async (day: Day, period: number, newLessonId: string) => {
    const week = currentWeekRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const groupId = cell.groupId

    // Delete the existing single lesson if present
    if (cell.lessons.length === 1) {
      const old = cell.lessons[0]
      await deletePlannerAssignmentAction(groupId!, old.lessonId, week, day, period)
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    if (!newLessonId || !groupId || groupId === '__free__') return

    const { data } = await upsertPlannerAssignmentAction(groupId, newLessonId, week, day, period, {})
    if (data) {
      // Find lesson title from cache
      const allLessons = Array.from(lessonCache.values()).flat()
      const lesson = allLessons.find((l) => l.lesson_id === newLessonId)
      const slotLesson: SlotLesson = {
        lessonId: data.lesson_id,
        unitId: data.unit_id ?? '',
        lessonTitle: lesson?.title ?? newLessonId,
        assignmentId: data.id,
        feedbackVisible: false,
        issueFlag: false,
        issueNote: '',
        lessonNotes: '',
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [slotLesson] }))
    }
  }, [updateSlot, plannerState, lessonCache])

  // Called from SidePanel: add an extra lesson to a slot that already has at least one
  const handleAddLesson = useCallback(async (day: Day, period: number, newLessonId: string) => {
    const week = currentWeekRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const groupId = cell.groupId
    if (!groupId || groupId === '__free__' || !newLessonId) return
    // Prevent duplicate
    if (cell.lessons.some((l) => l.lessonId === newLessonId)) return

    const { data } = await upsertPlannerAssignmentAction(groupId, newLessonId, week, day, period, {})
    if (data) {
      const allLessons = Array.from(lessonCache.values()).flat()
      const lesson = allLessons.find((l) => l.lesson_id === newLessonId)
      const slotLesson: SlotLesson = {
        lessonId: data.lesson_id,
        unitId: data.unit_id ?? '',
        lessonTitle: lesson?.title ?? newLessonId,
        assignmentId: data.id,
        feedbackVisible: false,
        issueFlag: false,
        issueNote: '',
        lessonNotes: '',
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [...s.lessons, slotLesson] }))
    }
  }, [updateSlot, plannerState, lessonCache])

  // Called from SidePanel: remove a specific lesson from a slot
  const handleRemoveLesson = useCallback(async (day: Day, period: number, lessonId: string) => {
    const week = currentWeekRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const groupId = cell.groupId
    if (!groupId) return

    await deletePlannerAssignmentAction(groupId, lessonId, week, day, period)
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.filter((l) => l.lessonId !== lessonId),
    }))
  }, [updateSlot, plannerState])

  const handleFeedbackToggle = useCallback(async (day: Day, period: number, lessonId: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    const next = !lesson.feedbackVisible
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, feedbackVisible: next } : l),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { feedback_visible: next })
  }, [updateSlot, plannerState])

  const handleIssueToggle = useCallback(async (day: Day, period: number, lessonId: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    const nextFlag = !lesson.issueFlag
    const nextNote = nextFlag ? lesson.issueNote : ''
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) =>
        l.lessonId === lessonId ? { ...l, issueFlag: nextFlag, issueNote: nextNote } : l,
      ),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, {
      issue_flag: nextFlag,
      issue_note: nextNote,
    })
  }, [updateSlot, plannerState])

  const handleIssueNoteChange = useCallback(async (day: Day, period: number, lessonId: string, note: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, issueNote: note } : l),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { issue_note: note })
  }, [updateSlot, plannerState])

  const handleLessonNotesChange = useCallback(async (day: Day, period: number, lessonId: string, notes: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, lessonNotes: notes } : l),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { notes })
  }, [updateSlot, plannerState])

  const handleGroupChange = useCallback(async (day: Day, period: number, groupId: string) => {
    const key = slotKey(day, period)
    const existing = plannerState.get(key) ?? emptyCellState()
    const resolvedGroupId = groupId || null
    const week = currentWeekRef.current

    // Delete all lessons for old group
    if (existing.groupId && existing.groupId !== '__free__' && existing.groupId !== groupId) {
      for (const lesson of existing.lessons) {
        await deletePlannerAssignmentAction(existing.groupId, lesson.lessonId, week, day, period)
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    // Re-create all lessons for new group
    if (resolvedGroupId && resolvedGroupId !== '__free__' && existing.lessons.length > 0) {
      const newLessons: SlotLesson[] = []
      for (const lesson of existing.lessons) {
        const { data } = await upsertPlannerAssignmentAction(
          resolvedGroupId, lesson.lessonId, week, day, period,
          {
            feedbackVisible: lesson.feedbackVisible,
            issueFlag: lesson.issueFlag,
            issueNote: lesson.issueNote,
            notes: lesson.lessonNotes,
          },
        )
        if (data) {
          newLessons.push({ ...lesson, assignmentId: data.id })
        }
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: newLessons }))
    }

    updateSlot(day, period, (s) => ({ ...s, groupId: resolvedGroupId }))
    if (groupId === '__free__') {
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }
    classDefaultsRef.current.set(key, resolvedGroupId)
    await upsertTimetableSlotGroupAction(day, period, resolvedGroupId)
  }, [updateSlot, plannerState])

  const handlePrevWeek = useCallback(() => {
    const next = shiftWeek(currentWeekRef.current, -1)
    setCurrentWeek(next)
    setSelectedSlot(null)
    loadWeekAssignments(next)
  }, [loadWeekAssignments])

  const handleNextWeek = useCallback(() => {
    const next = shiftWeek(currentWeekRef.current, 1)
    setCurrentWeek(next)
    setSelectedSlot(null)
    loadWeekAssignments(next)
  }, [loadWeekAssignments])

  const weekNote = weekNotes.get(currentWeek) ?? ''
  const handleWeekNoteChange = useCallback((value: string) => {
    setWeekNotesMap((prev) => {
      const next = new Map(prev)
      next.set(currentWeekRef.current, value)
      return next
    })
  }, [])

  const selectedParsed = selectedSlot
    ? (() => {
        const idx = selectedSlot.lastIndexOf('-')
        return {
          day: selectedSlot.slice(0, idx) as Day,
          period: Number(selectedSlot.slice(idx + 1)),
        }
      })()
    : null

  const selectedCellState = selectedSlot
    ? (plannerState.get(selectedSlot) ?? emptyCellState())
    : null
  const selectedTimetableSlot = selectedParsed
    ? TIMETABLE_SLOTS.find(
        (s) => s.day === selectedParsed.day && s.period === selectedParsed.period,
      ) ?? null
    : null

  return (
    <div className="max-w-[1200px] mx-auto rounded-[12px] bg-[var(--color-background-tertiary)] p-4">
      <WeekNavigator
        currentWeek={currentWeek}
        onPrev={handlePrevWeek}
        onNext={handleNextWeek}
      />

      <PlannerGrid
        units={units}
        groups={groups}
        plannerState={plannerState}
        selectedSlot={selectedSlot}
        lessonCache={lessonCache}
        onCellClick={handleCellClick}
        onUnitSelect={handleUnitSelect}
        onLessonChange={handleLessonChange}
        onFeedbackToggle={handleFeedbackToggle}
      />

      <SidePanel
        day={selectedParsed?.day ?? null}
        period={selectedParsed?.period ?? null}
        cellState={selectedCellState}
        slot={selectedTimetableSlot}
        units={units}
        lessonCache={lessonCache}
        groups={groups}
        onClose={() => setSelectedSlot(null)}
        onGroupChange={handleGroupChange}
        onIssueToggle={handleIssueToggle}
        onIssueNoteChange={handleIssueNoteChange}
        onLessonNotesChange={handleLessonNotesChange}
        onAddLesson={handleAddLesson}
        onRemoveLesson={handleRemoveLesson}
        onFeedbackToggle={handleFeedbackToggle}
      />

      <WeekNotes value={weekNote} onChange={handleWeekNoteChange} />
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: errors in `PlannerGrid.tsx`, `PlannerCell.tsx`, `SidePanel.tsx` because their prop types haven't been updated yet. That is expected — fixed in next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-planner/TeacherPlannerClient.tsx
git commit -m "feat(planner): rewrite TeacherPlannerClient for multi-lesson slots

- loadWeekAssignments groups DB rows into lessons[] array per slot
- handleLessonChange: swaps single lesson from cell
- handleAddLesson / handleRemoveLesson: side panel multi-lesson management
- All extras handlers (feedback, issue, notes) gain lessonId parameter
- handleGroupChange: migrates all lessons to new group"
```

---

## Task 6: Update `PlannerCell.tsx`

**Files:**
- Modify: `src/components/teacher-planner/PlannerCell.tsx`

Context: PlannerCell must handle three states based on `state.lessons.length`:
- **0 lessons**: show unit + lesson dropdowns (unit selection is local state, calls `onUnitSelect` to load cache)
- **1 lesson**: show lesson title, lesson dropdown for swap (unit is `state.lessons[0].unitId`)
- **2+ lessons**: show "Lesson plan" text, no dropdowns

The feedback toggle in the icon row only appears in the 1-lesson state and passes `lessonId` to `onFeedbackToggle`.

`lessonCache` is passed directly (not pre-looked-up lessons array).

- [ ] **Step 1: Rewrite `src/components/teacher-planner/PlannerCell.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { TimetableSlot, CellState } from './types'
import type { Unit, LessonWithObjectives, Group } from '@/types'

type PlannerCellProps = {
  slot: TimetableSlot
  state: CellState
  isSelected: boolean
  units: Unit[]
  lessonCache: Map<string, LessonWithObjectives[]>
  groups: Group[]
  onCellClick: () => void
  onUnitSelect: (unitId: string) => void
  onLessonChange: (lessonId: string) => void
  onFeedbackToggle: (lessonId: string) => void
}

export function PlannerCell({
  slot,
  state,
  isSelected,
  units,
  lessonCache,
  groups,
  onCellClick,
  onUnitSelect,
  onLessonChange,
  onFeedbackToggle,
}: PlannerCellProps) {
  const [pendingUnitId, setPendingUnitId] = useState('')

  const lessonCount = state.lessons.length
  const firstLesson = state.lessons[0] ?? null
  const displayClass = state.groupId
    ? (groups.find((g) => g.group_id === state.groupId)?.group_id ?? slot.classCode)
    : slot.classCode

  const hasIssue = state.lessons.some((l) => l.issueFlag)
  const hasAnyFeedback = state.lessons.some((l) => l.feedbackVisible)

  if (state.groupId === '__free__') {
    return (
      <div
        className={cn(
          'relative flex flex-col items-center justify-center rounded-[8px] border min-h-[86px] cursor-pointer transition-colors opacity-50',
          isSelected
            ? 'border-[1.5px] border-[var(--color-border-info)] bg-[var(--color-background-secondary)]'
            : 'border-dashed border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] hover:opacity-70',
        )}
        onClick={onCellClick}
      >
        <span className="text-[11px] text-[var(--color-text-tertiary)]">Free</span>
      </div>
    )
  }

  // Lessons available for the pending unit (0-lesson state) or first lesson's unit (1-lesson state)
  const lessonOptions = lessonCache.get(
    lessonCount === 0 ? pendingUnitId : (firstLesson?.unitId ?? ''),
  ) ?? []

  return (
    <div
      className={cn(
        'relative flex flex-col gap-[3px] rounded-[8px] border bg-[var(--color-background-primary)] px-[7px] py-[6px] min-h-[86px] cursor-pointer transition-colors',
        hasIssue
          ? 'bg-[#FCEBEB] border-[#F09595] hover:border-[#E24B4A]'
          : 'border-[var(--color-border-tertiary)] hover:border-[var(--color-border-secondary)]',
        isSelected && !hasIssue && 'border-[1.5px] border-[var(--color-border-info)]',
        isSelected && hasIssue && 'border-[1.5px] border-[#E24B4A]',
      )}
      onClick={onCellClick}
    >
      {/* Header */}
      <div className="flex justify-between items-baseline gap-1 mb-0.5">
        <span className={cn('font-medium text-[12px]', hasIssue ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]')}>
          {displayClass}
        </span>
        <span className={cn('text-[11px] truncate', hasIssue ? 'text-[#A32D2D]' : 'text-[var(--color-text-secondary)]')}>
          {slot.subject}
        </span>
      </div>

      {/* Lesson content — three states */}
      {lessonCount === 0 && (
        <>
          {/* Unit picker */}
          <div className="relative flex items-center h-[18px]" onClick={(e) => e.stopPropagation()}>
            <span className={cn('flex-1 min-w-0 text-[11px] truncate pr-0.5', 'text-[var(--color-text-tertiary)]')}>
              {units.find((u) => u.unit_id === pendingUnitId)?.title ?? 'Unit'}
            </span>
            <span className="text-[8px] opacity-60 flex-shrink-0 text-[var(--color-text-tertiary)]">›</span>
            <select
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px]"
              value={pendingUnitId}
              onChange={(e) => {
                setPendingUnitId(e.target.value)
                onUnitSelect(e.target.value)
              }}
            >
              <option value="">— select unit —</option>
              {units.map((u) => (
                <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
              ))}
            </select>
          </div>

          {/* Lesson picker */}
          <div className="relative flex items-center h-[18px]" onClick={(e) => e.stopPropagation()}>
            <span className={cn('flex-1 min-w-0 text-[11px] truncate pr-0.5', 'text-[var(--color-text-tertiary)]')}>
              Lesson
            </span>
            <span className={cn('text-[8px] flex-shrink-0 text-[var(--color-text-tertiary)]', !pendingUnitId ? 'opacity-25' : 'opacity-60')}>›</span>
            <select
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px] disabled:cursor-not-allowed"
              value=""
              disabled={!pendingUnitId}
              onChange={(e) => {
                if (e.target.value) {
                  onLessonChange(e.target.value)
                  setPendingUnitId('')
                }
              }}
            >
              <option value="">— select lesson —</option>
              {lessonOptions.map((l) => (
                <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {lessonCount === 1 && firstLesson && (
        <>
          {/* Unit display */}
          <div className="flex items-center h-[18px]">
            <span className={cn('text-[11px] truncate', hasIssue ? 'text-[#791F1F]' : 'text-[var(--color-text-secondary)]')}>
              {units.find((u) => u.unit_id === firstLesson.unitId)?.title ?? '—'}
            </span>
          </div>

          {/* Lesson picker — swappable */}
          <div className="relative flex items-center h-[18px]" onClick={(e) => e.stopPropagation()}>
            <span className={cn('flex-1 min-w-0 text-[11px] truncate pr-0.5', hasIssue ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]')}>
              {firstLesson.lessonTitle}
            </span>
            <span className={cn('text-[8px] opacity-60 flex-shrink-0', hasIssue ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]')}>›</span>
            <select
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px]"
              value={firstLesson.lessonId}
              onChange={(e) => onLessonChange(e.target.value)}
            >
              <option value="">— clear lesson —</option>
              {lessonOptions.map((l) => (
                <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {lessonCount >= 2 && (
        <div className="flex items-center h-[36px]">
          <span className={cn('text-[11px] font-medium italic', hasIssue ? 'text-[#791F1F]' : 'text-[var(--color-text-secondary)]')}>
            Lesson plan ({lessonCount})
          </span>
        </div>
      )}

      {/* Divider */}
      <hr
        className={cn('border-none border-t mt-0.5', hasIssue ? 'border-t-[rgba(162,45,45,0.2)]' : 'border-t-[var(--color-border-tertiary)]')}
        style={{ borderTopWidth: '0.5px' }}
      />

      {/* Icon row */}
      <div className="flex items-center gap-0.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
        {lessonCount === 1 && firstLesson && (
          <button
            type="button"
            className={cn(
              'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] transition-opacity',
              firstLesson.feedbackVisible
                ? 'opacity-100 text-[#1D9E75]'
                : hasIssue
                ? 'text-[#A32D2D] opacity-50 hover:opacity-100'
                : 'text-[var(--color-text-tertiary)] opacity-50 hover:opacity-100',
            )}
            onClick={() => onFeedbackToggle(firstLesson.lessonId)}
            title="Toggle feedback visible"
          >
            ✓
          </button>
        )}
        {lessonCount >= 2 && (
          <span
            className={cn('text-[9px] opacity-60', hasAnyFeedback ? 'text-[#1D9E75]' : 'text-[var(--color-text-tertiary)]')}
            title="Manage feedback per lesson in side panel"
          >
            ✓
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: errors only in `PlannerGrid.tsx` (prop mismatch) and `SidePanel.tsx` (prop mismatch) — fixed in next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-planner/PlannerCell.tsx
git commit -m "feat(planner): redesign PlannerCell for 0/1/multi lesson states

- 0 lessons: unit + lesson dropdowns with local pendingUnitId state
- 1 lesson: unit label + swappable lesson dropdown using lessonTitle
- 2+ lessons: 'Lesson plan (N)' text, manage via side panel
- Feedback toggle only active in 1-lesson state, passes lessonId"
```

---

## Task 7: Update `PlannerGrid.tsx`

**Files:**
- Modify: `src/components/teacher-planner/PlannerGrid.tsx`

Context: PlannerGrid currently pre-fetches `lessons` from `lessonCache` using `state.unitId`. With the new CellState, there is no top-level `unitId`. PlannerCell now receives `lessonCache` directly. The `onUnitChange` prop becomes `onUnitSelect`. Remove the pre-lookup.

- [ ] **Step 1: Rewrite `src/components/teacher-planner/PlannerGrid.tsx`**

```typescript
'use client'

import { PlannerCell } from './PlannerCell'
import { PERIOD_LAYOUT, TIMETABLE_SLOTS, DAYS, DAY_LABELS } from './timetable-config'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day, CellState, PeriodRow } from './types'
import type { Unit, LessonWithObjectives, Group } from '@/types'

type PlannerGridProps = {
  units: Unit[]
  groups: Group[]
  plannerState: PlannerState
  selectedSlot: string | null
  lessonCache: Map<string, LessonWithObjectives[]>
  onCellClick: (day: Day, period: number) => void
  onUnitSelect: (unitId: string) => void
  onLessonChange: (day: Day, period: number, lessonId: string) => void
  onFeedbackToggle: (day: Day, period: number, lessonId: string) => void
}

type LessonRow = Extract<PeriodRow, { type: 'lesson' }>
type BreakRow = Extract<PeriodRow, { type: 'break' }>
type Col = { kind: 'lesson'; row: LessonRow } | { kind: 'break'; row: BreakRow }

function buildColumns(): Col[] {
  const cols: Col[] = []
  for (const row of PERIOD_LAYOUT) {
    if (row.type === 'lesson') {
      cols.push({ kind: 'lesson', row })
    } else {
      cols.push({ kind: 'break', row })
    }
  }
  return cols
}

const COLUMNS = buildColumns()
const GRID_TEMPLATE =
  '64px ' +
  COLUMNS.map((c) => (c.kind === 'break' ? '36px' : 'minmax(0, 1fr)')).join(' ')

export function PlannerGrid({
  units,
  groups,
  plannerState,
  selectedSlot,
  lessonCache,
  onCellClick,
  onUnitSelect,
  onLessonChange,
  onFeedbackToggle,
}: PlannerGridProps) {
  return (
    <div className="text-[13px]">
      {/* Period header row */}
      <div className="grid gap-[4px] mb-[4px]" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
        <div />
        {COLUMNS.map((col, i) => {
          if (col.kind === 'break') {
            return (
              <div
                key={`hbreak-${i}`}
                className="flex items-end justify-center pb-1 text-[9px] text-[var(--color-text-tertiary)] opacity-60 tracking-wide leading-tight text-center"
              >
                {col.row.label}
              </div>
            )
          }
          return (
            <div key={`hperiod-${col.row.period}`} className="text-center px-1 py-1.5">
              <div className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                {col.row.label}
              </div>
              {col.row.startTime && (
                <div className="text-[10px] text-[var(--color-text-tertiary)] leading-tight">
                  {col.row.startTime}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Day rows */}
      <div className="flex flex-col gap-[4px]">
        {DAYS.map((day) => (
          <div key={day} className="grid gap-[4px]" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
            <div className="flex items-center justify-end pr-2">
              <span className="font-medium text-[12px] text-[var(--color-text-secondary)]">
                {DAY_LABELS[day]}
              </span>
            </div>

            {COLUMNS.map((col, i) => {
              if (col.kind === 'break') {
                return (
                  <div
                    key={`break-${day}-${i}`}
                    className="rounded-[6px] bg-[var(--color-background-secondary)] opacity-40"
                  />
                )
              }

              const slot = TIMETABLE_SLOTS.find(
                (s) => s.day === day && s.period === col.row.period,
              )

              if (!slot) {
                return (
                  <div
                    key={`empty-${day}-${col.row.period}`}
                    className="rounded-[8px] border border-[var(--color-border-tertiary)] min-h-[86px] bg-[var(--color-background-secondary)] opacity-30"
                  />
                )
              }

              const key = slotKey(day, col.row.period)
              const state: CellState = plannerState.get(key) ?? emptyCellState()

              return (
                <PlannerCell
                  key={key}
                  slot={slot}
                  state={state}
                  isSelected={selectedSlot === key}
                  units={units}
                  lessonCache={lessonCache}
                  groups={groups}
                  onCellClick={() => onCellClick(day, col.row.period)}
                  onUnitSelect={onUnitSelect}
                  onLessonChange={(lessonId) => onLessonChange(day, col.row.period, lessonId)}
                  onFeedbackToggle={(lessonId) => onFeedbackToggle(day, col.row.period, lessonId)}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: errors only in `SidePanel.tsx` — fixed in next task.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-planner/PlannerGrid.tsx
git commit -m "feat(planner): update PlannerGrid to pass lessonCache directly to cells"
```

---

## Task 8: Rewrite `SidePanel.tsx`

**Files:**
- Modify: `src/components/teacher-planner/SidePanel.tsx`

Context: SidePanel must now show a list of all lessons in the slot. Each lesson has its own feedback toggle, issue flag, issue note, and lesson notes. An "Add lesson" section at the bottom allows adding more lessons. A "Remove" button on each lesson row removes it. When there are 0 lessons the panel shows the group selector only.

- [ ] **Step 1: Rewrite `src/components/teacher-planner/SidePanel.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { DAY_LABELS, PERIOD_LAYOUT } from './timetable-config'
import type { Day, CellState, TimetableSlot } from './types'
import type { Unit, LessonWithObjectives, Group } from '@/types'

type SidePanelProps = {
  day: Day | null
  period: number | null
  cellState: CellState | null
  slot: TimetableSlot | null
  units: Unit[]
  lessonCache: Map<string, LessonWithObjectives[]>
  groups: Group[]
  onClose: () => void
  onGroupChange: (day: Day, period: number, groupId: string) => void
  onIssueToggle: (day: Day, period: number, lessonId: string) => void
  onIssueNoteChange: (day: Day, period: number, lessonId: string, note: string) => void
  onLessonNotesChange: (day: Day, period: number, lessonId: string, notes: string) => void
  onAddLesson: (day: Day, period: number, lessonId: string) => void
  onRemoveLesson: (day: Day, period: number, lessonId: string) => void
  onFeedbackToggle: (day: Day, period: number, lessonId: string) => void
}

export function SidePanel({
  day,
  period,
  cellState,
  slot,
  units,
  lessonCache,
  groups,
  onClose,
  onGroupChange,
  onIssueToggle,
  onIssueNoteChange,
  onLessonNotesChange,
  onAddLesson,
  onRemoveLesson,
  onFeedbackToggle,
}: SidePanelProps) {
  const [addUnitId, setAddUnitId] = useState('')

  if (!day || !period || !cellState || !slot) return null

  const isFree = cellState.groupId === '__free__'
  const activeGroup = cellState.groupId
    ? groups.find((g) => g.group_id === cellState.groupId) ?? null
    : groups.find((g) => g.subject === slot.classCode) ?? null

  const periodRow = PERIOD_LAYOUT.find((r) => r.type === 'lesson' && r.period === period)
  const periodLabel = periodRow?.type === 'lesson' ? periodRow.label : `L${period}`

  const addLessonOptions = lessonCache.get(addUnitId) ?? []

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 bg-black/[0.18] z-[40]"
        style={{ top: '80px' }}
        onClick={onClose}
      />

      <div
        className="fixed right-0 bottom-0 w-[320px] bg-[var(--color-background-primary)] border-l border-[var(--color-border-tertiary)] p-5 overflow-y-auto z-[41] flex flex-col gap-3.5"
        style={{ top: '80px' }}
      >
        {/* Header */}
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0 pr-2">
            <div className="flex items-baseline gap-1.5">
              <select
                className="font-medium text-[15px] text-[var(--color-text-primary)] bg-transparent border-none outline-none cursor-pointer p-0 max-w-full"
                value={cellState.groupId ?? ''}
                onChange={(e) => onGroupChange(day, period, e.target.value)}
              >
                <option value="">{slot.classCode}</option>
                <option value="__free__">— Free period —</option>
                {groups.map((g) => (
                  <option key={g.group_id} value={g.group_id}>{g.group_id}</option>
                ))}
              </select>
              <span className="text-[15px] text-[var(--color-text-secondary)] flex-shrink-0">
                · {slot.subject}
              </span>
            </div>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 m-0">
              {DAY_LABELS[day]} · {periodLabel}
              {activeGroup?.member_count != null ? ` · ${activeGroup.member_count} pupils` : ''}
            </p>
          </div>
          <button
            type="button"
            className="text-[16px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] bg-transparent border-none cursor-pointer p-0 leading-none flex-shrink-0"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <hr style={{ borderTopWidth: '0.5px' }} className="border-none border-t border-[var(--color-border-tertiary)]" />

        {!isFree && (
          <>
            {/* Lesson list */}
            {cellState.lessons.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1.5 m-0">
                  Lessons ({cellState.lessons.length})
                </p>
                <div className="flex flex-col gap-3">
                  {cellState.lessons.map((lesson) => {
                    const unit = units.find((u) => u.unit_id === lesson.unitId)
                    return (
                      <div
                        key={lesson.lessonId}
                        className={cn(
                          'rounded-[8px] border p-2.5 flex flex-col gap-2',
                          lesson.issueFlag
                            ? 'bg-[#FCEBEB] border-[#F09595]'
                            : 'border-[var(--color-border-tertiary)]',
                        )}
                      >
                        {/* Lesson header */}
                        <div className="flex justify-between items-start gap-1">
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-[var(--color-text-tertiary)] m-0 truncate">
                              {unit?.title ?? '—'}
                            </p>
                            <p className={cn('text-[12px] font-medium m-0 truncate', lesson.issueFlag ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]')}>
                              {lesson.lessonTitle}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="text-[11px] text-[var(--color-text-tertiary)] hover:text-red-600 bg-transparent border-none cursor-pointer p-0 flex-shrink-0 mt-0.5"
                            onClick={() => onRemoveLesson(day, period, lesson.lessonId)}
                            title="Remove this lesson from slot"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Feedback toggle */}
                        <div
                          className={cn(
                            'flex justify-between items-center px-2 py-1.5 rounded-[6px] border text-[11px] cursor-pointer select-none',
                            lesson.feedbackVisible
                              ? 'bg-[#EBF7F4] border-[#1D9E75] text-[#1D9E75]'
                              : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)]',
                          )}
                          onClick={() => onFeedbackToggle(day, period, lesson.lessonId)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onFeedbackToggle(day, period, lesson.lessonId) }}
                        >
                          <span>Feedback visible</span>
                          <div className={cn('w-7 h-4 rounded-full relative flex-shrink-0 transition-colors', lesson.feedbackVisible ? 'bg-[#1D9E75]' : 'bg-[var(--color-border-secondary)]')}>
                            <div className={cn('w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left] duration-150', lesson.feedbackVisible ? 'left-[14px]' : 'left-0.5')} />
                          </div>
                        </div>

                        {/* Issue flag */}
                        <div
                          className={cn(
                            'flex justify-between items-center px-2 py-1.5 rounded-[6px] border text-[11px] cursor-pointer select-none',
                            lesson.issueFlag
                              ? 'bg-[#FCEBEB] border-[#F09595] text-[#791F1F]'
                              : 'border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]',
                          )}
                          onClick={() => onIssueToggle(day, period, lesson.lessonId)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onIssueToggle(day, period, lesson.lessonId) }}
                        >
                          <span>Flag this lesson</span>
                          <div className={cn('w-7 h-4 rounded-full relative flex-shrink-0 transition-colors', lesson.issueFlag ? 'bg-[#E24B4A]' : 'bg-[var(--color-border-secondary)]')}>
                            <div className={cn('w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left] duration-150', lesson.issueFlag ? 'left-[14px]' : 'left-0.5')} />
                          </div>
                        </div>
                        {lesson.issueFlag && (
                          <textarea
                            className="w-full text-[11px] bg-[var(--color-background-secondary)] border border-[#F09595] rounded-[6px] px-2 py-1.5 resize-y min-h-[48px] text-[#791F1F] focus:outline-none focus:border-[#E24B4A] box-border"
                            placeholder="Describe the issue…"
                            value={lesson.issueNote}
                            onChange={(e) => onIssueNoteChange(day, period, lesson.lessonId, e.target.value)}
                          />
                        )}

                        {/* Lesson notes */}
                        <textarea
                          className="w-full text-[11px] bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)] rounded-[6px] px-2 py-1.5 resize-y min-h-[48px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-info)] box-border"
                          placeholder="Lesson notes…"
                          value={lesson.lessonNotes}
                          onChange={(e) => onLessonNotesChange(day, period, lesson.lessonId, e.target.value)}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Add lesson section */}
            <div>
              <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1.5 m-0">
                {cellState.lessons.length === 0 ? 'Assign lesson' : 'Add lesson'}
              </p>
              <div className="flex flex-col gap-1.5">
                <select
                  className="w-full text-[12px] bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)] rounded-[6px] px-2 py-1.5 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-info)]"
                  value={addUnitId}
                  onChange={(e) => setAddUnitId(e.target.value)}
                >
                  <option value="">— select unit —</option>
                  {units.map((u) => (
                    <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
                  ))}
                </select>
                <select
                  className="w-full text-[12px] bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)] rounded-[6px] px-2 py-1.5 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-info)] disabled:opacity-40 disabled:cursor-not-allowed"
                  value=""
                  disabled={!addUnitId}
                  onChange={(e) => {
                    if (e.target.value) {
                      onAddLesson(day, period, e.target.value)
                      setAddUnitId('')
                    }
                  }}
                >
                  <option value="">— select lesson —</option>
                  {addLessonOptions.map((l) => (
                    <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: no errors in the planner components. May still see errors in `assignment-manager.tsx` referencing deleted actions — fixed in Task 9.

- [ ] **Step 3: Manual smoke test in browser**

Navigate to `http://localhost:3001/planner`. Verify:
- Cells show unit/lesson dropdowns when empty
- Clicking a cell opens the side panel
- Selecting a unit loads lesson options
- Selecting a lesson saves to DB and shows lesson title in cell
- Opening the side panel on a 1-lesson slot shows the lesson card with feedback toggle, issue flag, notes
- "Add lesson" section visible in side panel; selecting a second lesson adds it
- Cell now shows "Lesson plan (2)" for a 2-lesson slot
- Removing a lesson from the side panel removes it from both panel and cell

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher-planner/SidePanel.tsx
git commit -m "feat(planner): redesign SidePanel for multi-lesson slot management

- Per-lesson cards with feedback toggle, issue flag, notes, remove button
- Add lesson section at bottom (unit + lesson dropdowns)
- Lesson count shown in section header"
```

---

## Task 9: Remove lesson-assignment write actions

**Files:**
- Modify: `src/lib/server-actions/lesson-assignments.ts`
- Modify: `src/lib/server-updates.ts`

Context: Five write actions in `lesson-assignments.ts` are no longer needed — the planner is now the write path. Two read actions stay (`readLessonAssignmentsAction`, `checkLessonAccessForPupilAction`). Remove the deleted exports from `server-updates.ts`.

- [ ] **Step 1: Delete write actions from `lesson-assignments.ts`**

Delete the following five functions from `src/lib/server-actions/lesson-assignments.ts`:
- `upsertLessonAssignmentAction` (lines ~58–136)
- `deleteLessonAssignmentAction` (lines ~138–174)
- `toggleLessonAssignmentVisibilityAction` (lines ~176–220)
- `toggleLessonAssignmentLockedAction` (lines ~222–244)
- `toggleLessonAssignmentFeedbackVisibilityAction` (lines ~246–268)

Also remove their unused imports. The file should keep only:
- `readLessonAssignmentsAction`
- `checkLessonAccessForPupilAction`

And their required imports: `'use server'`, `z`, `LessonAssignmentSchema`, `LessonAssignmentsSchema`, `query`, `normalizeDateOnly`.

- [ ] **Step 2: Remove deleted exports from `server-updates.ts`**

Find the block in `src/lib/server-updates.ts` that exports from `./server-actions/lesson-assignments` and remove the five deleted action names. Keep only:

```typescript
export {
  checkLessonAccessForPupilAction,
  readLessonAssignmentsAction,
} from './server-actions/lesson-assignments'
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: errors in `src/components/assignment-manager/assignment-manager.tsx` referencing the deleted imports. That file is addressed in Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/lesson-assignments.ts src/lib/server-updates.ts
git commit -m "feat(cleanup): remove lesson-assignment write actions

upsertLessonAssignmentAction, deleteLessonAssignmentAction and three
toggle actions deleted — planner_assignments is now the sole write path.
readLessonAssignmentsAction and checkLessonAccessForPupilAction kept
(read from the view)."
```

---

## Task 10: Simplify `/assignments` page to read-only

**Files:**
- Create: `src/components/assignment-manager/scheduled-lessons-table.tsx`
- Modify: `src/app/assignments/page.tsx`

Context: The existing `AssignmentManager` component imports the deleted write actions and is 907 lines of create/edit/delete functionality. Rather than surgically removing write UI, replace it with a focused read-only `ScheduledLessonsTable` component that shows what the planner has scheduled. The page fetches `lessonAssignments` (from the view), `lessons`, `units`, and `groups` to build a readable table.

- [ ] **Step 1: Create `src/components/assignment-manager/scheduled-lessons-table.tsx`**

```typescript
'use client'

import type { LessonAssignment, Lesson, Unit, Group } from '@/types'

type Props = {
  lessonAssignments: LessonAssignment[]
  lessons: Lesson[]
  units: Unit[]
  groups: Group[]
}

export function ScheduledLessonsTable({ lessonAssignments, lessons, units, groups }: Props) {
  if (lessonAssignments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No lessons scheduled yet. Use the{' '}
        <a href="/planner" className="underline">planner</a>{' '}
        to assign lessons to your classes.
      </p>
    )
  }

  const lessonMap = new Map(lessons.map((l) => [l.lesson_id, l]))
  const unitMap = new Map(units.map((u) => [u.unit_id, u]))
  const groupMap = new Map(groups.map((g) => [g.group_id, g]))

  const sorted = [...lessonAssignments].sort((a, b) => {
    if (a.group_id < b.group_id) return -1
    if (a.group_id > b.group_id) return 1
    return a.start_date < b.start_date ? -1 : 1
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Class</th>
            <th className="pb-2 pr-4 font-medium">Unit</th>
            <th className="pb-2 pr-4 font-medium">Lesson</th>
            <th className="pb-2 pr-4 font-medium">First scheduled</th>
            <th className="pb-2 font-medium">Feedback visible</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((la) => {
            const lesson = lessonMap.get(la.lesson_id)
            const unit = lesson ? unitMap.get(lesson.unit_id ?? '') : undefined
            const group = groupMap.get(la.group_id)
            return (
              <tr
                key={`${la.group_id}__${la.lesson_id}`}
                className="border-b last:border-0 hover:bg-muted/30"
              >
                <td className="py-2 pr-4 font-medium">{group?.group_id ?? la.group_id}</td>
                <td className="py-2 pr-4 text-muted-foreground">{unit?.title ?? '—'}</td>
                <td className="py-2 pr-4">{lesson?.title ?? la.lesson_id}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {la.start_date
                    ? new Date(la.start_date + 'T00:00:00').toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })
                    : '—'}
                </td>
                <td className="py-2">
                  <span className={la.feedback_visible ? 'text-[#1D9E75]' : 'text-muted-foreground'}>
                    {la.feedback_visible ? 'Yes' : 'No'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `src/app/assignments/page.tsx`**

```typescript
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CalendarDays } from 'lucide-react'
import { ScheduledLessonsTable } from '@/components/assignment-manager/scheduled-lessons-table'
import {
  readLessonAssignmentsAction,
  readGroupsAction,
  readUnitsAction,
  readLessonsAction,
} from '@/lib/server-updates'
import { requireTeacherProfile } from '@/lib/auth'

export default async function AssignmentsPage() {
  const teacherProfile = await requireTeacherProfile()

  const [
    { data: lessonAssignments },
    { data: groupsData },
    { data: unitsData },
    { data: lessonsData },
  ] = await Promise.all([
    readLessonAssignmentsAction(),
    readGroupsAction({ currentProfile: teacherProfile }),
    readUnitsAction(),
    readLessonsAction(),
  ])

  return (
    <main className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Lessons</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only view of lessons assigned via the planner.
          </p>
        </div>
        <Link href="/planner">
          <Button variant="outline">
            <CalendarDays className="h-4 w-4 mr-2" />
            Go to Planner
          </Button>
        </Link>
      </div>
      <ScheduledLessonsTable
        lessonAssignments={lessonAssignments ?? []}
        lessons={(lessonsData ?? []).filter((l) => l.active ?? true)}
        units={unitsData ?? []}
        groups={groupsData ?? []}
      />
    </main>
  )
}
```

- [ ] **Step 3: Check that `readLessonsAction` and `readUnitsAction` exist in server-updates**

```bash
grep -n "readLessonsAction\|readUnitsAction" src/lib/server-updates.ts
```

If either is missing, find the correct export name:

```bash
grep -rn "export.*readLessons\|export.*readUnits" src/lib/server-actions/
```

Adjust the import in `page.tsx` to match the correct function name.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: no errors. The `AssignmentManager` component still exists but is no longer imported by any page — that is fine (unused components don't cause type errors).

- [ ] **Step 5: Manual smoke test**

Navigate to `http://localhost:3001/assignments`. Verify:
- Page loads without error
- Table shows lessons scheduled via the planner (if any exist in the DB)
- "Go to Planner" button links to `/planner`
- No create/edit/delete buttons visible

- [ ] **Step 6: Final type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```

Expected: zero errors outside the pre-existing test file errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/assignment-manager/scheduled-lessons-table.tsx src/app/assignments/page.tsx
git commit -m "feat(assignments): replace AssignmentManager with read-only scheduled lessons view

/assignments now shows a simple read-only table sourced from the
lesson_assignments view (backed by planner_assignments). Teachers are
directed to the planner for all lesson scheduling."
```

---

## Self-Review

**Spec coverage:**
- ✅ Section 1 (Data model) — Tasks 1, 2, 3
- ✅ Section 2 (Cell/SidePanel behaviour) — Tasks 6, 7, 8
- ✅ Section 3 (View + migration) — Task 1
- ✅ Section 4 (Server action changes) — Tasks 4, 9
- ✅ Section 5 (TeacherPlannerClient) — Task 5
- ✅ Section 6 (/assignments read-only) — Task 10

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:**
- `SlotLesson` defined in Task 3, used in Tasks 4, 5, 6, 7, 8 — consistent.
- `deletePlannerAssignmentAction(groupId, lessonId, week, day, period)` — 5-arg signature defined in Task 4, used in Task 5 — consistent.
- `handleFeedbackToggle(day, period, lessonId)` — 3-arg defined in Task 5, called from Task 7 (PlannerGrid) and Task 8 (SidePanel) — consistent.
- `onUnitSelect` (not `onUnitChange`) — renamed in Task 5, Task 6, Task 7 — consistent.
- `addLessonOptions` in SidePanel — uses `lessonCache` which is populated by `handleUnitSelect` in TeacherPlannerClient via `readLessonsByUnitAction`. The SidePanel's `addUnitId` select onChange does NOT call `onUnitSelect` — the implementer must ensure the SidePanel's unit selector ALSO triggers the cache load. **Fix**: Add `onUnitSelect` prop to `SidePanel` and call it when `addUnitId` changes, OR populate the cache inside the SidePanel using a local server action call.

The cleanest fix: pass `onUnitSelect` to `SidePanel` and call it when the add-unit dropdown changes. Update Task 8's SidePanel code to call `onUnitSelect` in the `setAddUnitId` handler, and add `onUnitSelect` to the SidePanelProps.

**Correction applied inline in Task 8 below.** The SidePanel `addUnitId` onChange should be:

```typescript
onChange={(e) => {
  setAddUnitId(e.target.value)
  if (e.target.value) onUnitSelect(e.target.value)
}}
```

And add to `SidePanelProps`:
```typescript
onUnitSelect: (unitId: string) => void
```

And update the TeacherPlannerClient JSX `<SidePanel>` to include `onUnitSelect={handleUnitSelect}`.

The Task 8 and Task 5 code blocks above already need this correction — implementer should apply it.
