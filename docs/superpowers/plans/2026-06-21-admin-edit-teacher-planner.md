# Admin Edit Access to Teacher Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins edit any teacher's Teacher Planner (assign classes, add lessons, edit notes/flags) while non-admin teachers viewing another teacher's planner stay read-only.

**Architecture:** Add a single authorization helper (`requireTeacherOrAdminAccess`) that gates every planner write action by comparing the caller's profile against an explicit `targetTeacherId` the client already has in scope (the teacher selected in the dropdown). Server actions gain a `targetTeacherId` parameter; the client's `readOnly` flag and write-call sites are updated to pass it through. No schema changes.

**Tech Stack:** Next.js server actions, PostgreSQL (`pg` via `query()`), Zod for action result validation, React client component.

**Testing note:** This repo has no unit/integration test runner for server actions (no jest/vitest, no DB mocking pattern — confirmed during investigation). The only test tooling is Playwright E2E (`npm test`), which needs a live server + seeded DB and isn't wired for this kind of permission-matrix testing. Each task below therefore ends with a concrete **manual verification** step (exact UI actions and expected outcome) instead of an automated test step. Task 6 is an end-to-end manual pass exercising the full feature.

---

### Task 1: Add `requireTeacherOrAdminAccess` auth helper

**Files:**
- Modify: `src/lib/auth.ts`

- [ ] **Step 1: Add the helper function**

Add this after `hasRole` (after line 33), before `buildSigninRedirect`:

```ts
export async function requireTeacherOrAdminAccess(targetTeacherId: string): Promise<AuthenticatedProfile> {
  const profile = await requireTeacherProfile()
  if (targetTeacherId !== profile.userId && !hasRole(profile, 'admin')) {
    throw new Error("Not authorized to edit this teacher's planner")
  }
  return profile
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`
Expected: no new errors introduced by this change (pre-existing unrelated errors in `tests/prototypes/fast-ui.spec.ts` are fine).

- [ ] **Step 3: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/lib/auth.ts
git commit -m "Add requireTeacherOrAdminAccess auth helper"
```

---

### Task 2: Authorize `upsertTimetableSlotGroupAction` for admin-on-behalf-of edits

**Files:**
- Modify: `src/lib/server-actions/timetable-slot-groups.ts:18-37`

- [ ] **Step 1: Update the function signature and auth call**

Replace lines 18-37 with:

```ts
export async function upsertTimetableSlotGroupAction(
  day: string,
  period: number,
  groupId: string | null,
  targetTeacherId?: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    const profile = await requireTeacherProfile()
    const resolvedTargetTeacherId = targetTeacherId ?? profile.userId
    await requireTeacherOrAdminAccess(resolvedTargetTeacherId)
    await query(
      `INSERT INTO timetable_slot_groups (teacher_id, day, period, group_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (teacher_id, day, period)
       DO UPDATE SET group_id = EXCLUDED.group_id`,
      [resolvedTargetTeacherId, day, period, groupId],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save slot group'
    return NullResult.parse({ data: null, error: message })
  }
}
```

Note: this calls `requireTeacherProfile()` once (to get the caller's own profile for the default case) and `requireTeacherOrAdminAccess` again (which internally calls `requireTeacherProfile()` a second time) — this is a redundant DB round-trip but matches the existing codebase's preference for simple, explicit code over micro-optimization (see other actions in this file, which already call `requireTeacherProfile()` independently per action). Leave as-is; do not refactor for efficiency here.

- [ ] **Step 2: Update the import line**

Update line 5 from:
```ts
import { requireTeacherProfile } from '@/lib/auth'
```
to:
```ts
import { requireTeacherProfile, requireTeacherOrAdminAccess } from '@/lib/auth'
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`
Expected: errors at every call site of `upsertTimetableSlotGroupAction` that doesn't yet pass a 4th argument are fine for now (TypeScript won't error since the param is optional) — expect no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/lib/server-actions/timetable-slot-groups.ts
git commit -m "Authorize upsertTimetableSlotGroupAction for admin-on-behalf-of edits"
```

---

### Task 3: Authorize planner-assignment write actions

**Files:**
- Modify: `src/lib/server-actions/planner-assignments.ts:45-94` (`upsertPlannerAssignmentAction`)
- Modify: `src/lib/server-actions/planner-assignments.ts:96-118` (`deletePlannerAssignmentAction`)
- Modify: `src/lib/server-actions/planner-assignments.ts:154-180` (`updatePlannerAssignmentExtrasAction`)

- [ ] **Step 1: Update the import line**

Update line 5 from:
```ts
import { requireTeacherProfile } from '@/lib/auth'
```
to:
```ts
import { requireTeacherProfile, requireTeacherOrAdminAccess } from '@/lib/auth'
```

- [ ] **Step 2: Update `upsertPlannerAssignmentAction`**

Replace lines 45-94 with:

```ts
export async function upsertPlannerAssignmentAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
  day: string,
  period: number,
  targetTeacherId: string,
  extras?: {
    notes?: string
    issueFlag?: boolean
    issueNote?: string
    feedbackVisible?: boolean
  },
): Promise<z.infer<typeof AssignmentResult>> {
  try {
    const profile = await requireTeacherOrAdminAccess(targetTeacherId)
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
```

(Only change from the original: the new `targetTeacherId` parameter inserted before `extras`, and `requireTeacherProfile()` replaced with `requireTeacherOrAdminAccess(targetTeacherId)`. `created_by` still uses `profile.userId`, which is now the admin's id when an admin is acting — satisfying the "record admin as actor" decision with no further change.)

- [ ] **Step 3: Update `deletePlannerAssignmentAction`**

Replace lines 96-118 (now shifted — find by function name) with:

```ts
export async function deletePlannerAssignmentAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
  day: string,
  period: number,
  targetTeacherId: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherOrAdminAccess(targetTeacherId)
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
```

- [ ] **Step 4: Update `updatePlannerAssignmentExtrasAction`**

Replace lines 153-179 (find by function name) with:

```ts
export async function updatePlannerAssignmentExtrasAction(
  id: string,
  patch: Partial<Pick<PlannerAssignment, 'notes' | 'issue_flag' | 'issue_note' | 'feedback_visible'>>,
  targetTeacherId: string,
): Promise<z.infer<typeof AssignmentResult>> {
  try {
    await requireTeacherOrAdminAccess(targetTeacherId)
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

- [ ] **Step 5: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`
Expected: errors at the call sites in `TeacherPlannerClient.tsx` because `targetTeacherId` is now a required parameter that isn't being passed yet — that's expected and will be fixed in Task 5. Confirm the errors are exactly the call sites you expect (4 calls to `upsertPlannerAssignmentAction`, 4 to `deletePlannerAssignmentAction`, 2 to `updatePlannerAssignmentExtrasAction`) and nothing else.

- [ ] **Step 6: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/lib/server-actions/planner-assignments.ts
git commit -m "Authorize planner assignment writes for admin-on-behalf-of edits"
```

---

### Task 4: Pass `isAdmin` from the Teacher Planner page

**Files:**
- Modify: `src/app/teacher-planner/page.tsx`

- [ ] **Step 1: Compute and pass `isAdmin`**

Replace the full file content with:

```tsx
import { readGroupsAction, readUnitsAction, readTeachersAction } from '@/lib/server-updates'
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage() {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')

  const [groupsResult, unitsResult, teachersResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
    readTeachersAction(),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[95%] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
      />
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/app/teacher-planner/page.tsx
git commit -m "Pass isAdmin into TeacherPlannerClient"
```

(Type errors from the new `isAdmin` prop not yet existing on `TeacherPlannerClientProps` are expected and resolved in Task 5 — don't run a standalone type-check checkpoint here, it'll be covered by Task 5's check.)

---

### Task 5: Unlock editing for admins in `TeacherPlannerClient`

**Files:**
- Modify: `src/components/teacher-planner/TeacherPlannerClient.tsx`

- [ ] **Step 1: Add `isAdmin` to props and update `readOnly`**

Change line 25-30 (`TeacherPlannerClientProps`):

```ts
type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
  teachers: { userId: string; firstName: string | null; lastName: string | null }[]
  currentTeacherId: string
  isAdmin: boolean
}
```

Change line 36:

```ts
export function TeacherPlannerClient({ units, groups, teachers, currentTeacherId, isAdmin }: TeacherPlannerClientProps) {
```

Change line 45:

```ts
  const readOnly = selectedTeacherId !== currentTeacherId && !isAdmin
```

- [ ] **Step 2: Pass `selectedTeacherId` as `targetTeacherId` into every write call**

Update `handleLessonChange` (lines 179-211): change the two write calls at line 186 and line 192:

```ts
  const handleLessonChange = useCallback(async (day: Day, period: number, newLessonId: string) => {
    const week = currentWeekRef.current
    const teacherId = selectedTeacherIdRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const existing = cell.lessons[0] ?? null

    if (existing) {
      await deletePlannerAssignmentAction(cell.groupId!, existing.lessonId, week, day, period, teacherId)
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    if (!newLessonId || !cell.groupId || cell.groupId === '__free__') return

    const { data } = await upsertPlannerAssignmentAction(cell.groupId, newLessonId, week, day, period, teacherId, {})
    if (data) {
      // Find unitId and lessonTitle from cache
      let unitId = ''
      let lessonTitle = ''
      for (const [uid, lessons] of lessonCache) {
        const found = lessons.find((l) => l.lesson_id === newLessonId)
        if (found) { unitId = uid; lessonTitle = found.title; break }
      }
      const newLesson: SlotLesson = {
        lessonId: data.lesson_id,
        unitId,
        lessonTitle,
        assignmentId: data.id,
        feedbackVisible: false,
        lessonNotes: '',
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [newLesson] }))
    }
  }, [updateSlot, plannerState, lessonCache])
```

Update `handleAddLesson` (lines 213-239): change the write call at line 221:

```ts
  const handleAddLesson = useCallback(async (day: Day, period: number, newLessonId: string) => {
    const week = currentWeekRef.current
    const teacherId = selectedTeacherIdRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()

    if (!newLessonId || !cell.groupId || cell.groupId === '__free__') return
    if (cell.lessons.some((l) => l.lessonId === newLessonId)) return

    const { data } = await upsertPlannerAssignmentAction(cell.groupId, newLessonId, week, day, period, teacherId, {})
    if (data) {
      let unitId = ''
      let lessonTitle = ''
      for (const [uid, lessons] of lessonCache) {
        const found = lessons.find((l) => l.lesson_id === newLessonId)
        if (found) { unitId = uid; lessonTitle = found.title; break }
      }
      const newLesson: SlotLesson = {
        lessonId: data.lesson_id,
        unitId,
        lessonTitle,
        assignmentId: data.id,
        feedbackVisible: false,
        lessonNotes: '',
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [...s.lessons, newLesson] }))
    }
  }, [updateSlot, plannerState, lessonCache])
```

Update `handleRemoveLesson` (lines 241-248):

```ts
  const handleRemoveLesson = useCallback(async (day: Day, period: number, lessonId: string) => {
    const week = currentWeekRef.current
    const teacherId = selectedTeacherIdRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    if (!cell.groupId) return
    await deletePlannerAssignmentAction(cell.groupId, lessonId, week, day, period, teacherId)
    updateSlot(day, period, (s) => ({ ...s, lessons: s.lessons.filter((l) => l.lessonId !== lessonId) }))
  }, [updateSlot, plannerState])
```

Update `handleFeedbackToggle` (lines 255-266), the call at line 265:

```ts
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
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { feedback_visible: next }, selectedTeacherIdRef.current)
  }, [updateSlot, plannerState])
```

Update `handleLessonNotesChange` (lines 284-294), the call at line 293:

```ts
  const handleLessonNotesChange = useCallback(async (day: Day, period: number, lessonId: string, notes: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, lessonNotes: notes } : l),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { notes }, selectedTeacherIdRef.current)
  }, [updateSlot, plannerState])
```

Update `handleGroupChange` (lines 296-327):

```ts
  const handleGroupChange = useCallback(async (day: Day, period: number, groupId: string) => {
    const key = slotKey(day, period)
    const existing = plannerState.get(key)
    const resolvedGroupId = groupId || null
    const teacherId = selectedTeacherIdRef.current

    if (existing?.groupId && existing.groupId !== groupId && groupId !== '__free__') {
      const week = currentWeekRef.current
      for (const lesson of existing.lessons) {
        await deletePlannerAssignmentAction(existing.groupId, lesson.lessonId, week, day, period, teacherId)
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    if (resolvedGroupId && resolvedGroupId !== '__free__' && existing?.lessons.length) {
      const week = currentWeekRef.current
      for (const lesson of existing.lessons) {
        await upsertPlannerAssignmentAction(resolvedGroupId, lesson.lessonId, week, day, period, teacherId, {
          feedbackVisible: lesson.feedbackVisible,
          notes: lesson.lessonNotes,
        })
      }
    }

    updateSlot(day, period, (s) => ({ ...s, groupId: resolvedGroupId }))
    if (groupId === '__free__') {
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    const classDefaults = classDefaultsByTeacherRef.current.get(teacherId)
    classDefaults?.set(key, resolvedGroupId)
    await upsertTimetableSlotGroupAction(day, period, resolvedGroupId, teacherId)
  }, [updateSlot, plannerState])
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`
Expected: no errors (only the pre-existing unrelated `tests/prototypes/fast-ui.spec.ts` errors, if any).

- [ ] **Step 4: Build**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/components/teacher-planner/TeacherPlannerClient.tsx
git commit -m "Unlock Teacher Planner editing for admins viewing another teacher"
```

---

### Task 6: Manual end-to-end verification

**No files changed in this task — verification only.**

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run dev`

- [ ] **Step 2: Verify admin can edit another teacher's planner**

1. Sign in as a user with the `admin` role (check `user_roles` table for an existing admin, or use the `/admin` role management page to grant yourself the role if testing locally).
2. Navigate to `/teacher-planner`.
3. Select a different teacher from the dropdown.
4. Confirm the grid is NOT visually disabled (matches the "own planner" experience — no banner, per design).
5. Click an empty period cell, assign a class via the side panel — confirm it saves (no error toast/console error) and persists after switching weeks and back.
6. Add a unit + lesson to that slot — confirm it saves and appears in the grid.
7. Toggle feedback visibility and add lesson notes on that lesson — confirm both persist.
8. Refresh the page, re-select the same teacher — confirm all the above changes are still there (proves they were actually written to the DB scoped to the *target* teacher, not the admin).

- [ ] **Step 3: Verify non-admin teacher still gets read-only view of others**

1. Sign in as a regular teacher (no `admin` role).
2. Navigate to `/teacher-planner`, select a different teacher in the dropdown.
3. Confirm the grid is read-only exactly as before this change (no editing controls usable) — this should be unchanged from current production behavior.

- [ ] **Step 4: Verify server-side rejection for a non-admin tampering attempt**

1. While still signed in as the non-admin teacher from Step 3, open the browser console.
2. Manually invoke one of the write actions with a mismatched `targetTeacherId` (e.g. via React DevTools or by temporarily editing `selectedTeacherId` state) — alternatively, confirm via code review that `requireTeacherOrAdminAccess` is unconditionally called server-side in Task 2/3's code, so even if this manual step is impractical, the server-side guard is structurally guaranteed to run regardless of client state.
3. Confirm the action returns an error result (not an unhandled crash) — e.g. check the dev server logs / response for `{ error: "Not authorized to edit this teacher's planner" }`.

- [ ] **Step 5: Confirm own-planner editing still works for everyone**

1. As both the admin and the regular teacher, confirm editing their *own* planner (selectedTeacherId === currentTeacherId) still works exactly as before — assign classes, add/remove lessons, toggle feedback, edit notes.
