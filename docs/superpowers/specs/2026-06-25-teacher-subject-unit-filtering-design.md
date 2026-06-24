# Teacher–Subject Association & Unit Filtering in Planner

## Problem

The teacher planner's unit picker (used to assign a unit to a lesson slot) currently shows every active unit in the system via `readUnitsAction()`, regardless of which subject(s) a teacher actually teaches. This makes the dropdown long and irrelevant for most teachers.

## Goal

Let teachers self-associate with one or more subjects on their profile page. Use that association to scope the planner's unit list to units whose subject matches one of the teacher's subjects.

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

- `readTeacherSubjectsAction(options?: { userId?: string })` — returns the list of subjects (`string[]`) associated with a profile. Defaults to the current authenticated profile when `userId` is omitted. Requires the target profile to have `is_teacher = true` (consistent with `requireTeacherProfile()` guard pattern used elsewhere).
- `updateTeacherSubjectsAction(subjects: string[])` — replaces the *current* authenticated teacher's full subject association set in a single transaction (delete all rows for `user_id`, then insert the new set). Self-service only: a teacher can only edit their own associations, never another profile's. Validates `subjects` against the `subjects` table (must be active subjects) before writing — the FK constraint also enforces this at the DB level.

Both follow the standard `{ data, error }` shape and `withTelemetry` wrapping used throughout `src/lib/server-actions/`. Re-export through `src/lib/server-updates.ts`.

## Profile page UI

Add a new `TeacherSubjects` client component (`src/components/profile/teacher-subjects.tsx`), modeled on the existing `ProfileGroups` component pattern in `src/components/profile/groups.tsx`.

- Rendered as a new section in `src/app/profiles/[profileId]/page.tsx`, directly after the "Groups" section.
- Only rendered when the profile being viewed has `is_teacher = true`.
- Shows a checkbox list of all active subjects (from `readAllSubjectsAction`), pre-checked according to `readTeacherSubjectsAction`.
- A "Save" action calls `updateTeacherSubjectsAction` with the full checked set and shows a `sonner` toast on success/error, following the optimistic-update pattern described in CLAUDE.md.

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
  4. Profile page: a teacher can check/uncheck subjects and the change persists and reflects immediately in their planner dropdown.
