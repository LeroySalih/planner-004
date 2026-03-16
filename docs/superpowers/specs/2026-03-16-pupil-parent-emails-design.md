# Design: Pupil Parent Email Fields

**Date:** 2026-03-16
**Feature:** Add father's email and mother's email to pupil profiles, editable inline from `/reports`.

---

## Overview

Teachers need to record parent contact emails (father and mother) against each pupil. These fields should be visible and editable directly in the `/reports` table, saving automatically when the user tabs out of the field.

---

## Data Layer

### Migration

Add two nullable text columns to the `profiles` table:

```sql
ALTER TABLE profiles ADD COLUMN father_email text;
ALTER TABLE profiles ADD COLUMN mother_email text;
```

File: `src/migrations/067-add-parent-emails.sql`

> Migration numbering: the highest migration number across both `src/migrations/` and `src/migrations/applied/` is `066` (`066-ai-queue-process-after.sql`), so `067` is correct. Check both directories together, not just `applied/`.

### Server Action

**Function:** `updatePupilParentEmailAction(pupilId: string, field: 'father_email' | 'mother_email', value: string | null)`

- Location: `src/lib/server-actions/groups.ts`
- Guards with `requireTeacherProfile()`
- Returns `{ data: null, error: string | null }` — consistent with project-wide `{ data, error }` convention
- Validates `value` with `z.string().email().nullable()` before writing. If validation fails, return `{ data: null, error: "Invalid email address." }`. Note: the client always converts empty string to `null` before calling; any other non-email string reaching the server will be rejected by this Zod check.
- Uses two literal SQL strings selected via `if/else` on `field` — do **not** interpolate the column name as a variable:
  ```ts
  const sql = field === 'father_email'
    ? 'UPDATE profiles SET father_email = $2 WHERE user_id = $1 AND is_teacher = false'
    : 'UPDATE profiles SET mother_email = $2 WHERE user_id = $1 AND is_teacher = false'
  ```
  The `AND is_teacher = false` guard prevents accidentally overwriting a teacher's profile.
- After executing, check `result.rowCount === 0`. If zero rows updated, return `{ data: null, error: "Pupil not found." }`. Otherwise return `{ data: null, error: null }`.
- No `revalidatePath` call needed — the client component maintains its own local state after a successful save.
- No `withTelemetry` wrapper — write actions in `groups.ts` do not use it; telemetry is applied at the call site in server components where needed.

**Re-export** the new action from `src/lib/server-updates.ts`.

### Data Enrichment

`listPupilsWithGroupsAction` already performs a second `SELECT` using the pooled `query()` helper from `src/lib/db.ts`. Extend **that same `query()` call** (do not open a new `pg.Client`):

```sql
SELECT user_id, email, is_teacher, father_email, mother_email
FROM profiles
WHERE user_id = ANY($1::text[])
```

Then attach `fatherEmail` and `motherEmail` to each raw row alongside the existing enrichments, before Zod parsing. If the enrichment query fails (the existing catch swallows errors), `fatherEmail`/`motherEmail` will be `undefined` on each row — this is handled gracefully by the client (`initialValue ?? ""`).

> Note: `listPupilsWithGroupsAction` has no auth guard at the action level — it relies on the `/reports/page.tsx` route calling `requireTeacherProfile()` first. This is a pre-existing pattern; do not change it as part of this feature.

### Zod Schema

Extend `ReportsPupilListingSchema` in `src/types/index.ts`:

```ts
fatherEmail: z.string().email().nullable().optional(),
motherEmail: z.string().email().nullable().optional(),
```

The `.optional()` means these fields may be absent (e.g. if enrichment fails), producing `undefined` in TypeScript. The client handles `undefined` the same as `null` via `initialValue ?? ""`.

---

## UI Layer

### ReportsTablePupil type

Add `fatherEmail` and `motherEmail` (`string | null | undefined`) to the `ReportsTablePupil` type in `reports-table.tsx`.

### Page mapping

In `src/app/reports/page.tsx`, extend the `.map()` to pass through `fatherEmail` and `motherEmail` from the listing.

### Table columns

Add two columns to the `<thead>` row: **Father's Email** and **Mother's Email**.

The existing empty-state `<td colSpan={4}>` must be updated to `<td colSpan={6}>` to match the new column count.

### Editable cell component

A new `ParentEmailCell` component (co-located in `reports-table.tsx`):

```
Props: pupilId, field ('father_email' | 'mother_email'), initialValue (string | null | undefined)
```

**State model:**
- `value` in `useState<string>` — the current input value, initialised to `initialValue ?? ""`
- `savedValue` in `useRef<string>` — tracks the last successfully saved value, initialised to `initialValue ?? ""`. Stored in a `useRef` (not state) so mutations don't trigger re-renders. The component does **not** respond to `initialValue` prop changes after mount — the ref is intentionally not synced via `useEffect`.
- `isPending` via `useTransition`

**`onBlur` behaviour:**
1. Trim `value`
2. If trimmed value equals `savedValue.current`, return (no-op)
3. Pass `trimmed === "" ? null : trimmed` to the action
4. Call `updatePupilParentEmailAction(pupilId, field, valueOrNull)` inside `startTransition`
5. On success (`!result.error`): set `savedValue.current = trimmed`; `toast.success("Saved")`
6. On error: set `value` state back to `savedValue.current`; `toast.error(result.error ?? "Failed to save")`

**Input attributes:**
- `type="email"` — browser format hint
- `autoComplete="off"` — prevents browser suggesting the teacher's own email across 30+ pupil rows
- `disabled={isPending}` — prevents double-submit; no additional spinner needed (consistent with existing patterns in the file)
- Styled consistently with the existing filter input (same `border border-border bg-background px-3 py-2 text-sm rounded-md` classes)

### Filter behaviour

Parent email columns are **not** included in the existing filter — filtering by parent email is out of scope for this feature.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Save fails (network/DB) | Revert input to `savedValue.current`; `toast.error` |
| Invalid email (server Zod check fails) | `result.error` returned; revert + `toast.error` |
| Teacher profile targeted (is_teacher = false guard) | 0 rows updated; action returns "Pupil not found."; toast displayed |
| Unauthorised user | Server action returns `{ data: null, error: "Unauthorised" }`; toast displayed |
| Blur with unchanged value | `savedValue.current` comparison short-circuits; no action fired |
| Blur with empty input | Value normalised to `null`; stores `NULL` in database |
| Pupil not found (rowCount = 0) | Returns `{ data: null, error: "Pupil not found." }`; revert + `toast.error` |
| Enrichment query fails silently | `fatherEmail`/`motherEmail` are `undefined`; cell renders empty (correct graceful degradation) |

---

## Files Changed

| File | Change |
|---|---|
| `src/migrations/067-add-parent-emails.sql` | New migration |
| `src/types/index.ts` | Extend `ReportsPupilListingSchema` |
| `src/lib/server-actions/groups.ts` | Extend enrichment query + new `updatePupilParentEmailAction` |
| `src/lib/server-updates.ts` | Re-export new action |
| `src/app/reports/page.tsx` | Pass `fatherEmail`/`motherEmail` through mapping |
| `src/app/reports/reports-table.tsx` | New columns + `ParentEmailCell` + fix `colSpan` |

---

## Out of Scope

- Displaying or editing parent emails in pupil detail pages (`/reports/[pupilId]`)
- Filtering the reports table by parent email
- Bulk import/export of parent emails
- Adding auth guard to `listPupilsWithGroupsAction` (pre-existing pattern; separate concern)
