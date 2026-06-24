# Teacher–Subject Association & Unit Filtering in Planner

## Problem

The teacher planner's unit picker (used to assign a unit to a lesson slot) currently shows every active unit in the system via `readUnitsAction()`, regardless of which subject(s) a teacher actually teaches. This makes the dropdown long and irrelevant for most teachers.

## Goal

Let admins associate teachers with one or more subjects from the admin area. Use that association to scope the planner's unit list to units whose subject matches one of the teacher's subjects.

## Out of scope

- Pupils are never associated with subjects — only profiles with `is_teacher = true`.
- No change to how units relate to curricula — `units.subject` and `curricula.subject` already match directly via plain text columns (confirmed in `schema.sql`), so no new linking table is needed there.
- Admins are not filtered — they keep seeing all active units in the planner, same as today.

## Schema change

New many-to-many junction table:

```sql
CREATE TABLE public.teacher_subjects (
  user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  subject text NOT NULL REFERENCES subjects(subject) ON DELETE CASCADE,
  PRIMARY KEY (user_id, subject)
);
```

No `active` column — a row's existence means "associated"; removing the row means "not associated."

## Server actions

New file `src/lib/server-actions/teacher-subjects.ts`:

- `readTeacherSubjectsAction(options?: { userId?: string })` — returns the list of subjects (`string[]`) associated with a profile. Defaults to the current authenticated profile when `userId` is omitted. Requires the target profile to have `is_teacher = true` (consistent with `requireTeacherProfile()` guard pattern used elsewhere). Used by the planner page to read the logged-in teacher's own subjects.
- `readAllTeacherSubjectsAction()` — admin-only bulk read returning `{ userId: string, subject: string }[]` across all teachers, for rendering the admin grid without N+1 queries.
- `updateTeacherSubjectsAction(userId: string, subjects: string[])` — replaces the full subject association set for the given teacher in a single transaction (delete all rows for `user_id`, then insert the new set). Admin-only: guarded with `requireRole('admin')`, not self-service — teachers cannot edit their own associations. Validates `subjects` against the `subjects` table (must be active subjects) before writing — the FK constraint also enforces this at the DB level.

Both follow the standard `{ data, error }` shape and `withTelemetry` wrapping used throughout `src/lib/server-actions/`. Re-export through `src/lib/server-updates.ts`.

## Admin page UI

No change to the profile page — teachers cannot self-assign subjects.

New admin page `src/app/admin/teacher-subjects/page.tsx` (admin-only route, guarded the same way as `src/app/admin/roles/page.tsx` via `requireRole('admin')`), listing every teacher profile (`is_teacher = true`, from `readAllProfilesAction` filtered client/server-side) with a checkbox row of active subjects (from `readAllSubjectsAction`) next to each.

- New `TeacherSubjectManager` client component (`src/components/admin/teacher-subject-manager.tsx`), modeled on the existing `RoleManager` component pattern (`src/components/admin/role-manager.tsx`) and `SubjectManager` for the checkbox-grid interaction style.
- Initial data: for each teacher, pre-fetch their current subjects via `readTeacherSubjectsAction({ userId })` (or a bulk variant — see below) so checkboxes are pre-checked.
- Toggling a checkbox calls `updateTeacherSubjectsAction(userId, subjects)` with that teacher's full updated subject set, with a `sonner` toast on success/error, following the optimistic-update pattern described in CLAUDE.md.
- Add a link to this new page from the admin nav, alongside "Subjects" and "Roles".

To avoid N+1 queries when rendering the admin grid, add a bulk read: `readAllTeacherSubjectsAction()` returning `{ userId, subject }[]` for every teacher, which the page groups into a `Map<userId, string[]>` before passing to the component.

## Planner filtering

In `src/app/teacher-planner/page.tsx`:

- Alongside the existing `readUnitsAction()` call, fetch the logged-in profile's subjects via `readTeacherSubjectsAction()`.
- After loading units:
  - If `isAdmin` → pass the full unit list through unchanged.
  - Else → filter to `unit.subject` being a member of the teacher's subject set. An empty subject set yields an empty unit list (teachers with no subjects configured see no units, prompting them to set up their profile).
- This filter applies based on the **logged-in** profile, not whichever teacher's timetable is currently being viewed via `selectedTeacherId` — admins already bypass filtering entirely, and non-admins can only edit their own timetable (`readOnly` gating already exists for viewing others').
- No changes needed to `readUnitsAction` SQL — filtering happens in the page component using the `subject` field already returned on each unit row.

## Testing

- No unit test infrastructure in this project; rely on existing Playwright E2E conventions if a planner test exists, otherwise manual verification:
  1. As a teacher with no subjects configured: planner unit dropdown is empty.
  2. As a teacher with one subject configured matching some units: dropdown shows only those units.
  3. As an admin: dropdown shows all active units regardless of admin's own subject associations.
  4. Admin page: an admin can check/uncheck subjects for a given teacher, the change persists, and is reflected the next time that teacher loads their planner.
  5. A non-admin teacher cannot call `updateTeacherSubjectsAction` (server-side role check rejects it even if attempted directly).
