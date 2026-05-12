# Duplicate Unit — Design Spec

**Date:** 2026-05-12  
**Status:** Approved

## Overview

Allow teachers to duplicate a unit from both `/units` (list) and `/units/[unitId]` (detail) pages. The duplicate is a full isolated copy: new unit, new lessons, new activities, new file attachments. Learning Objectives and Success Criteria are shared references — not copied.

## Version Naming

The duplicate title is derived by parsing a trailing `.vN` suffix:

| Original title   | Duplicate title    |
|------------------|--------------------|
| Systems 1        | Systems 1.v1       |
| Systems 1.v1     | Systems 1.v2       |
| Systems 1.v9     | Systems 1.v10      |
| AQA Paper 2      | AQA Paper 2.v1     |

Implemented as a pure function — no DB lookup, no uniqueness guarantee (acceptable; two independent duplicates produce sibling versions).

## Data Map

### Inside one `withDbClient` transaction

1. **`units`** — new `unit_id` (UUID), versioned title, same `subject`, `description`, `year`, `active = true`
2. **`lessons`** — per lesson: new `lesson_id`, same `title`, `order_by`, `active`, foreign key → new `unit_id`
3. **`lessons_learning_objective`** — per row: new `lesson_id`, same `learning_objective_id`, `title`, `order_index`, `order_by`, `active` (shared LO reference)
4. **`lesson_success_criteria`** — per row: new `lesson_id`, same `success_criteria_id` (shared SC reference)
5. **`lesson_links`** — per row: new `lesson_link_id`, new `lesson_id`, same `url`, `description`
6. **`activities`** — per activity: new `activity_id`, new `lesson_id`, same `title`, `type`, `body_data`, `order_by`, `active`, `is_summative`, `notes`
7. **`activity_success_criteria`** — per row: new `activity_id`, same `success_criteria_id` (shared SC reference, new junction row)

### After transaction commits (filesystem)

7. **Lesson files** — for each lesson, copy all files from  
   `files/lessons/<old_lesson_id>/` → `files/lessons/<new_lesson_id>/`  
   using the existing `local-storage` client. File copy failures do not roll back the unit — they surface as a warning toast listing affected lessons.

### Not duplicated

- Unit-level files (`files/units/`)
- `lesson_assignments` (group scheduling)
- Submissions, pupil data, feedback

## Server Action

**Location:** `src/lib/server-actions/units.ts`  
**Name:** `duplicateUnitAction(unitId: string)`  
**Pattern:** Synchronous — caller awaits full completion before redirect.

```
1. requireTeacherProfile()
2. Load source unit + lessons + activities + links + LO refs + SC refs
3. Open withDbClient transaction
   a. Insert new unit (versioned title)
   b. For each lesson → insert new lesson, collect old→new lesson_id map
   c. Bulk insert lessons_learning_objective rows (new lesson_ids)
   d. Bulk insert lesson_success_criteria rows (new lesson_ids)
   e. Bulk insert lesson_links rows (new lesson_ids)
   f. Bulk insert activities rows (new lesson_ids)
   g. Bulk insert activity_success_criteria rows (new activity_ids)
4. Commit transaction
5. Copy lesson files (per lesson, using local-storage client)
   - Track any failures
6. revalidatePath('/units')
7. Return { data: { newUnitId, fileWarnings }, error: null }
```

Return shape:
```ts
{ data: { newUnitId: string; fileWarnings: string[] } | null; error: string | null }
```

## UI

### `/units` list page — `UnitCard`

- Add a "Duplicate" button below the existing "View unit →" link.
- On click: call `duplicateUnitAction`, show spinner, disable button.
- On success: `router.push(/units/<newUnitId>)`.
- On error: sonner error toast, re-enable button.
- On partial success (file warnings): redirect + sonner warning toast.

### `/units/[unitId]` detail page — unit header

- Add a "Duplicate Unit" button in the unit header area near existing edit controls.
- Same loading/success/error behaviour as above.

### Component location

New client component: `src/components/units/duplicate-unit-trigger.tsx`  
Shared between both pages — accepts `unitId` and `unitTitle` as props.

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| DB transaction fails | Full rollback, error toast, no redirect |
| File copy fails (partial) | New unit exists, redirect + warning toast listing failed lessons |
| Auth failure | Error toast, no redirect |

## Constraints

- No confirmation dialog — duplication is non-destructive.
- `activity_success_criteria` rows are duplicated as part of the transaction (same `success_criteria_id`, new `activity_id`).
- `lesson_assignments` are not duplicated — the new unit starts unscheduled.
