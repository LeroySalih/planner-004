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

### Server Action

**Function:** `updatePupilParentEmailAction(pupilId: string, field: 'father_email' | 'mother_email', value: string | null)`

- Location: `src/lib/server-actions/groups.ts` (alongside existing pupil actions)
- Guards with `requireTeacherProfile()`
- Uses parameterised query: `UPDATE profiles SET <field> = $2 WHERE user_id = $1`
- Returns `{ success: true }` or `{ success: false, error: string }`
- Field name is validated against an allowlist (`['father_email', 'mother_email']`) before interpolation to prevent SQL injection

### Data Enrichment

`listPupilsWithGroupsAction` in `src/lib/server-actions/groups.ts` already performs a second `SELECT` from `profiles` to attach `email` and `is_teacher`. Extend that query to also select `father_email` and `mother_email`, then attach them to each raw row before Zod parsing.

Query change:
```sql
SELECT user_id, email, is_teacher, father_email, mother_email
FROM profiles
WHERE user_id = ANY($1::text[])
```

### Zod Schema

Extend `ReportsPupilListingSchema` in `src/types/index.ts`:

```ts
fatherEmail: z.string().email().nullable().optional(),
motherEmail: z.string().email().nullable().optional(),
```

Re-export updated type; no other type changes needed.

---

## UI Layer

### ReportsTablePupil type

Add `fatherEmail` and `motherEmail` (`string | null | undefined`) to the `ReportsTablePupil` type in `reports-table.tsx`.

### Page mapping

In `src/app/reports/page.tsx`, extend the `.map()` to pass through `fatherEmail` and `motherEmail` from the listing.

### Table columns

Add two columns to the `<thead>` row: **Father's Email** and **Mother's Email**.

### Editable cell component

A new `ParentEmailCell` component (co-located in `reports-table.tsx`):

```
Props: pupilId, field ('father_email' | 'mother_email'), initialValue
```

Behaviour:
- Controlled `<input type="email">` initialised from `initialValue`
- `onBlur`: if value differs from `initialValue`, call `updatePupilParentEmailAction`
- While saving: input is `disabled` (prevents double-submit)
- On success: `toast.success("Saved")`; update the ref so further blurs don't re-save the same value
- On error: revert to previous value + `toast.error(message)`

This mirrors the existing `TeacherToggle` pattern: local state, transition, toast feedback.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Invalid email format | Browser `type="email"` provides basic validation; server ignores format (stores whatever is passed); blank value is stored as `NULL` |
| Save fails (network/DB) | Revert input to pre-edit value; show `toast.error` |
| Unauthorised user | Server action returns error; toast displayed |

---

## Files Changed

| File | Change |
|---|---|
| `src/migrations/067-add-parent-emails.sql` | New migration |
| `src/types/index.ts` | Extend `ReportsPupilListingSchema` |
| `src/lib/server-actions/groups.ts` | Extend enrichment query + new `updatePupilParentEmailAction` |
| `src/lib/server-updates.ts` | Re-export new action |
| `src/app/reports/page.tsx` | Pass `fatherEmail`/`motherEmail` through mapping |
| `src/app/reports/reports-table.tsx` | New columns + `ParentEmailCell` component |

---

## Out of Scope

- Validation that the value is a valid email format on the server
- Displaying parent emails in pupil detail pages (`/reports/[pupilId]`)
- Bulk import/export of parent emails
