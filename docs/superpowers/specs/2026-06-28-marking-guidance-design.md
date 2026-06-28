# Marking Guidance (per-subject reusable guidance for AI marking)

## Problem

Teachers configuring AI-marked activities (starting with **Upload Worksheet**) currently type the entire marking guidance by hand every time, even when the same rules apply across many lessons in a subject. Admins want to define a library of reusable "Marking Guidance" statements per subject, which teachers can pick from a dropdown to supplement their own free-text guidance.

## Scope

- Admin CRUD for Marking Guidance entries, scoped per subject.
- Single-select guidance dropdown on the **Upload Worksheet** activity editor only. (Upload Spreadsheet and Short Text Question are explicitly out of scope for this iteration — same pattern can be extended later.)
- Resolution of the selected guidance into the text sent to the AI marking webhook.

## Data Model

New table `marking_guidances`:

```sql
CREATE TABLE marking_guidances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL REFERENCES subjects(subject),
  title TEXT NOT NULL,
  content TEXT NOT NULL,        -- markdown
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `active = false` is the only deletion mechanism (soft delete). There is no hard delete in the UI.
- No `updated_at` is needed beyond what's already conventional elsewhere in this codebase — follow whatever existing tables actually do (check `subjects`/`teacher_subjects` migrations for the closest precedent and match it).

### Zod schema (`src/types/index.ts`)

```ts
const MarkingGuidanceSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  active: z.boolean().default(true),
  createdAt: z.string().optional(),
})
```

## Admin UI

- New route `/admin/marking-guidance`, linked from the existing admin nav alongside `/admin/subjects`.
- `MarkingGuidanceManager` component (`src/components/admin/MarkingGuidanceManager.tsx`), following the structure of `SubjectManager`:
  - List entries grouped by subject (subject picker or grouped sections — match whatever pattern `SubjectManager`/`teacher-subjects` admin UI already uses for subject grouping).
  - "Add guidance" form: subject select (from `readAllSubjectsAction`), title text input, markdown content via the existing `RichTextEditor` component.
  - Edit in place; "Deactivate" toggle instead of delete (mirrors `setSubjectActiveAction` pattern). Deactivated entries remain visible in the admin list (greyed out / marked inactive) so admins can reactivate them.

### Server actions (`src/lib/server-actions/marking-guidance.ts`)

- `readMarkingGuidancesAction(subject?: string)` — all guidances, optionally filtered by subject; returns active and inactive (admin view shows all).
- `createMarkingGuidanceAction({ subject, title, content })`
- `updateMarkingGuidanceAction({ id, title, content })`
- `setMarkingGuidanceActiveAction({ id, active })`

All follow the standard `{ data, error }` shape, Zod-validated, guarded with `requireRole('teacher')` admin check matching the existing `/admin/subjects` actions' guard.

Re-export through `src/lib/server-updates.ts`.

## Upload Worksheet Activity Editor

### Schema change (`src/types/index.ts`)

```ts
UploadWorksheetActivityBodySchema = z.object({
  task: z.string().min(1),
  markingGuidance: z.string().optional().default(''),
  markingGuidanceId: z.string().uuid().optional(),
}).passthrough()
  .refine(
    (body) => body.markingGuidance.trim().length > 0 || !!body.markingGuidanceId,
    { message: 'Provide marking guidance text or select a guidance', path: ['markingGuidance'] }
  )
```

- `markingGuidance` is no longer required to be non-empty on its own; validation passes if either the free-text field or `markingGuidanceId` is present.

### Editor UI (`src/components/lessons/lesson-activities-manager.tsx`)

Near the existing Upload Worksheet marking guidance `RichTextEditor` (around line 4294-4329):

- Add a single-select dropdown ("Marking guidance template") above the `RichTextEditor`, populated with **active** guidances for the lesson's subject.
  - Subject is resolved the same way the rest of this component already resolves lesson → unit → subject (reuse existing derived value, don't re-derive).
  - Options: guidance titles for the resolved subject; "None" as the default/cleared option.
  - If the activity already references a guidance that is now inactive (soft-deleted after being selected), still show it in the dropdown — visually marked "(inactive)" — so the existing selection isn't silently dropped from the UI.
- State: add `markingGuidanceId` alongside the existing `uploadWorksheetBody` state (`createDefaultUploadWorksheetBody()` gets `markingGuidanceId: undefined`).
- The free-text `RichTextEditor` placeholder updates to clarify it's optional when a template is selected, e.g. "Add any additional guidance (optional if a marking guidance template is selected)".
- Form save validation: block save only if both the dropdown is "None" AND the free-text field is empty (mirrors the schema refine, surfaced as a form error rather than a thrown Zod error where this component already does that kind of pre-submit check).

## AI Marking Resolution (`src/lib/ai/marking-queue.ts`)

In the upload-worksheet branch (around line 292-332), after parsing `UploadWorksheetActivityBodySchema`:

1. If `parsedActivity.markingGuidanceId` is set, look up the guidance by id (regardless of `active` status — soft-deleted/deactivated guidances must still resolve for existing activities).
2. If found: `marking_guidance = `\`${guidance.content}\n\n${parsedActivity.markingGuidance}\`\`.trim()` (guidance content prepended, separated by a blank line, then the teacher's free text appended; either side may be empty after trim).
3. If `markingGuidanceId` is set but the row no longer exists (defensive — shouldn't happen since deletion is soft-only, but guards against manual DB cleanup), fall back to `parsedActivity.markingGuidance` alone.
4. If `markingGuidanceId` is not set, behavior is unchanged: send `parsedActivity.markingGuidance` as-is.

No changes to `ai-marking-client.ts` — it continues to receive a single resolved `marking_guidance` string.

## Out of Scope

- Upload Spreadsheet and Short Text Question activities (no `markingGuidanceId` field added to their schemas in this iteration).
- Multi-select of guidances — only one guidance may be selected per activity.
- Hard delete of guidances.

## Testing

- Manual verification: create a guidance for a subject in admin, select it on an Upload Worksheet activity, confirm save succeeds with empty free-text, confirm AI marking queue resolves the combined text correctly (check queue payload/logs).
- No existing Playwright coverage for upload-worksheet marking guidance; add a basic spec only if convenient — not a hard requirement for this iteration given "No unit test infrastructure yet" project convention.
