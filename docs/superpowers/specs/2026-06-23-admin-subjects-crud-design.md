# Admin Subjects CRUD — Design

## Problem

Subjects (e.g. "Maths", "English") are stored in the `subjects` table and referenced by free-text `subject` columns on `units` and `curricula` (no foreign key — joins/matches are by string value, per existing `units → curricula` join convention). There is currently no admin UI to add, list, or deactivate subjects — `readSubjectsAction` only exposes active subjects to teachers, with no write path at all.

## Goals

- Admin page at `/admin/subjects` to view all subjects (active and inactive) and add new ones.
- Soft delete only: toggle a subject's `active` flag, matching the existing `active` column and the School Years admin pattern (`/admin/school-years`).
- No rename support: the subjects table has no separate display label — the `subject` text value is both the key and the display string, and it's referenced by plain-text columns on `units`/`curricula` with no FK to keep them in sync. Renaming would silently orphan those references. To "rename," an admin deactivates the old subject and adds a new one.
- Reuse the existing `readSubjectsAction` (teacher-facing, active-only) unchanged — it's consumed elsewhere in the app (e.g. flashcards, pupil units) and is out of scope.

## Non-goals

- No rename/edit of subject text.
- No hard delete.
- No changes to `units`/`curricula` schema or their `subject` columns.

## Design

### Server actions

In `src/lib/server-actions/subjects.ts`, add three new exports alongside the existing `readSubjectsAction`:

```ts
export async function readAllSubjectsAction(): Promise<{ data: Subject[] | null; error: string | null }>
```
- Calls `requireRole('admin')`.
- `SELECT subject, active FROM subjects ORDER BY subject ASC` (no `WHERE active = true` filter, unlike `readSubjectsAction`).

```ts
export async function createSubjectAction(subject: string): Promise<{ data: null; error: string | null }>
```
- Calls `requireRole('admin')`.
- Trims `subject`; rejects if empty after trim (`"Subject name is required."`).
- Case-insensitively checks the trimmed value against existing subjects (`SELECT 1 FROM subjects WHERE lower(subject) = lower($1)`); rejects with `"This subject already exists."` if found (no DB unique constraint to rely on).
- `INSERT INTO subjects (subject, active) VALUES ($1, true)`.

```ts
export async function setSubjectActiveAction(subject: string, active: boolean): Promise<{ data: null; error: string | null }>
```
- Calls `requireRole('admin')`.
- `UPDATE subjects SET active = $2 WHERE subject = $1`.

All three follow the existing `school-years.ts` pattern: use `query()` from `@/lib/db` (not the raw `pg.Client` pattern in the old `readSubjectsAction`), wrap in try/catch, return `{ data, error }` parsed through a Zod result schema.

Re-export all three from `src/lib/server-updates.ts` alongside the existing `readSubjectsAction` export.

### UI

**`src/app/admin/subjects/page.tsx`** (new, server component):

```tsx
import { readAllSubjectsAction } from '@/lib/server-updates'
import { SubjectManager } from '@/components/admin/SubjectManager'

export default async function SubjectsPage() {
  const { data } = await readAllSubjectsAction()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Subjects</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Add subjects or deactivate ones no longer in use. Only active subjects appear in subject pickers across the app.
        </p>
      </div>
      <SubjectManager initialSubjects={data ?? []} />
    </div>
  )
}
```

**`src/components/admin/SubjectManager.tsx`** (new, client component), modeled directly on `SchoolYearManager.tsx`:

- Local state: `subjects: Subject[]` (initialized from `initialSubjects`), `newSubject: string`, `saving: boolean`.
- "Add subject": text input + button. On click: client-side trim/empty check, call `createSubjectAction`, on success prepend `{ subject, active: true }` to local state (re-sorted alphabetically) and toast success; on error toast the returned error message.
- List: one row per subject, divided list matching `SchoolYearManager`'s `divide-y` container. Each row shows:
  - Subject name — `line-through` + muted color when `active: false`.
  - "inactive" badge (same pill styling as `SchoolYearManager`) when `active: false`.
  - A single button: "Deactivate" (ghost variant) when active, "Activate" (outline variant) when inactive — calls `setSubjectActiveAction(subject, !active)`, updates local state optimistically, toasts result.
- No edit/rename button (deliberately omitted per the no-rename decision).
- Empty state: "No subjects configured." when the list is empty.

### Admin dashboard

In `src/app/admin/page.tsx`, add a new card in the existing grid, linking to `/admin/subjects`, following the exact pattern of the other cards (e.g. the "School Years" card): icon (`BookOpen` from `lucide-react`), title "Subjects", value "Configure", blurb "Add and deactivate subjects".

## Testing

- Manual verification via dev server: add a subject, confirm it appears and persists on reload; attempt a duplicate (case-insensitive) and confirm it's rejected; deactivate a subject and confirm it disappears from a teacher-facing active-subject picker (e.g. wherever `readSubjectsAction` is consumed) while still appearing (struck through) in the admin list; reactivate and confirm it reappears in the picker.
- No Playwright test required unless requested — matches the existing pattern (no E2E coverage exists for `/admin/school-years` either).
