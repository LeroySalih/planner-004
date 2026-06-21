# Admin Edit Access to Teacher Planner — Design

## Problem

The Teacher Planner page (`/teacher-planner`) lets any teacher select another teacher from a dropdown and view their planner, but the view is read-only for anyone other than the planner's owner. Admins need full edit access to any teacher's planner — assigning classes to timetable slots, and adding units/lessons to their schedule — without changing behavior for non-admin teachers viewing each other's planners.

## Goals

- Admins (users with the `admin` role) can edit any teacher's planner: assign classes to timetable slots, add lessons to slots, edit assignment extras (notes/flags/feedback visibility), delete assignments.
- Non-admin teachers viewing another teacher's planner keep the existing read-only behavior — unchanged.
- Admin-driven writes are attributed to the admin as the actor (not silently recorded as the target teacher), wherever an actor field already exists.
- No visible UI indicator distinguishing "editing as admin" mode — editing simply unlocks.
- No schema changes to `timetable_slot_groups` (no new audit column).

## Non-goals

- Unit/lesson creation already operates on global resources with no per-teacher ownership; no changes needed there.
- No audit trail beyond what already exists (`planner_assignments.created_by`).
- No granular admin permissions (e.g. "can edit but not delete") — admin role is all-or-nothing for this page.

## Design

### 1. Authorization helper

Add a helper in `src/lib/auth.ts`:

```ts
export async function requireTeacherOrAdminAccess(targetTeacherId: string) {
  const profile = await requireTeacherProfile()
  if (targetTeacherId !== profile.userId && !hasRole(profile, 'admin')) {
    throw new Error("Not authorized to edit this teacher's planner")
  }
  return profile
}
```

This replaces the bare `requireTeacherProfile()` call in every write path that acts on a specific teacher's planner data. It returns the *caller's* profile (the admin, if acting on someone else's planner), so callers can use `profile.userId` for actor attribution.

### 2. Server action changes

**`src/lib/server-actions/timetable-slot-groups.ts`**

- `upsertTimetableSlotGroupAction(day, period, groupId, targetTeacherId?)`:
  - New optional `targetTeacherId` param, defaulting to the caller's own id when omitted (preserves existing call sites for teachers editing their own planner).
  - Call `requireTeacherOrAdminAccess(targetTeacherId)` instead of `requireTeacherProfile()`.
  - Insert/upsert using `targetTeacherId` as the slot's `teacher_id` (the slot still belongs to the target teacher — only the audit/actor semantics differ, and there's no audit column on this table per the non-goals above).

**`src/lib/server-actions/planner-assignments.ts`**

- `upsertPlannerAssignmentAction(groupId, lessonId, weekStartDate, day, period, targetTeacherId, extras?)`:
  - New required `targetTeacherId` param (the assignment is scoped by `groupId`, but we need the target teacher to run the authorization check against the correct timetable slot owner).
  - Call `requireTeacherOrAdminAccess(targetTeacherId)`.
  - Continue writing `created_by = profile.userId` — this naturally becomes the admin's id when an admin is acting, satisfying "record admin as actor" without a schema change.
- `deletePlannerAssignmentAction(groupId, lessonId, weekStartDate, day, period, targetTeacherId)`:
  - New required `targetTeacherId` param.
  - Call `requireTeacherOrAdminAccess(targetTeacherId)` before deleting.
- `updatePlannerAssignmentExtrasAction(id, patch, targetTeacherId)`:
  - New required `targetTeacherId` param.
  - Call `requireTeacherOrAdminAccess(targetTeacherId)` before updating.

All three of these take `targetTeacherId` directly from the caller (the client already knows which teacher's planner is being viewed/edited — `selectedTeacherId` in `TeacherPlannerClient.tsx`) rather than resolving it via a DB lookup from `groupId`/`id`. This keeps the change mechanical: no new joins, just a permission gate using data the client already has in scope.

### 3. Client changes

**`src/app/teacher-planner/page.tsx`**

- After `requireTeacherProfile()`, also compute `isAdmin = hasRole(profile, 'admin')` and pass it as a prop to `TeacherPlannerClient`.

**`src/components/teacher-planner/TeacherPlannerClient.tsx`**

- `readOnly` becomes: `selectedTeacherId !== currentTeacherId && !isAdmin`.
- Every call site that invokes `upsertTimetableSlotGroupAction`, `upsertPlannerAssignmentAction`, `deletePlannerAssignmentAction`, or `updatePlannerAssignmentExtrasAction` passes `selectedTeacherId` as the new `targetTeacherId` argument.
- No banner, no other visual change — editing unlocks silently per the goals above.

### 4. Error handling

- `requireTeacherOrAdminAccess` throws; each server action already wraps its body in `try/catch` and returns `{ data: null, error: message }` in its existing result shape, so the thrown authorization error surfaces through the existing error-handling path with no new pattern needed.
- If a non-admin somehow calls a write action with a `targetTeacherId` that isn't their own (e.g. stale client state, tampered request), the action returns an error result rather than throwing an unhandled exception — consistent with existing behavior.

## Testing

- No existing unit/integration test infrastructure covers these server actions (confirmed during the related bug-fix investigation — only Playwright E2E specs exist, requiring a live server/DB).
- Verification will be manual: as an admin, select another teacher in the dropdown, confirm slot assignment / lesson assignment / delete / edit-extras all succeed and persist correctly scoped to that teacher; as a non-admin, confirm viewing another teacher's planner remains fully read-only (UI disabled and, as defense in depth, a direct call with a mismatched `targetTeacherId` is rejected server-side).

## Files touched

- `src/lib/auth.ts` — add `requireTeacherOrAdminAccess`
- `src/lib/server-actions/timetable-slot-groups.ts` — `upsertTimetableSlotGroupAction`
- `src/lib/server-actions/planner-assignments.ts` — `upsertPlannerAssignmentAction`, `deletePlannerAssignmentAction`, `updatePlannerAssignmentExtrasAction`
- `src/app/teacher-planner/page.tsx` — pass `isAdmin` prop
- `src/components/teacher-planner/TeacherPlannerClient.tsx` — `readOnly` logic, pass `targetTeacherId` through write calls
