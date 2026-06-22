# Upload Spreadsheet Activity Type

## Summary

A new scorable activity type, `upload-spreadsheet`. The teacher writes a task
description and marking guidance. The pupil uploads a completed `.xlsx` file
in response. On submit, the task, marking guidance, and parsed spreadsheet
contents are sent to the existing AI marking pipeline (n8n via the
`ai_marking_queue`), which returns a score and feedback through the existing
`/webhooks/ai-mark` inbound webhook.

This follows the same shape as `short-text-question` (AI marking) crossed
with `upload-file` (file upload + storage), reusing both pipelines rather
than building new ones.

## Activity type registration

Add `upload-spreadsheet` to `SCORABLE_ACTIVITY_TYPES` in
`src/dino.config.ts`.

## Body schemas (`src/types/index.ts`)

```ts
UploadSpreadsheetActivityBodySchema = {
  task: string,             // rich text, shown to pupil
  markingGuidance: string,  // rich text, sent to AI only, not shown to pupil
}

UploadSpreadsheetSubmissionBodySchema = {
  filePath: string,         // local storage path of current file
  fileName: string,         // original filename
  ai_model_score: number (0-1) | null,
  ai_model_feedback: string | null,
  teacher_override_score: number (0-1) | null,
  is_correct: boolean,
  teacher_feedback: string | null,
  success_criteria_scores: Record<string, number | null>,
}
```

## Teacher editor

In `lesson-activities-manager.tsx`, add a form section for
`upload-spreadsheet` with two rich-text fields, matching the
`short-text-question` editor pattern:

- **Task** — instructions shown to the pupil.
- **Marking guidance** — sent to the AI to guide scoring; never shown to the
  pupil.

Both fields required (non-empty after trim), validated the same way
`validateShortTextBody()` validates `question`/`modelAnswer`.

## Pupil submission component

New `pupil-upload-spreadsheet-activity.tsx`, modeled on
`pupil-upload-activity.tsx`:

- Accepts only `.xlsx` — validated by extension and MIME type, both
  client-side and server-side.
- 5MB max file size, matching the existing `upload-file` limit.
- **Replaceable**: the pupil can upload a new file at any time before the
  lesson/assignment deadline or lock, exactly like `upload-file`. Each
  replacement:
  - Overwrites the stored file using the existing versioned-filename scheme
    in `local-storage.ts` (timestamp-suffixed on collision).
  - Updates the submission's `filePath`/`fileName`.
  - Re-enqueues the submission into `ai_marking_queue`, which re-triggers AI
    marking and overwrites the previous `ai_model_score` /
    `ai_model_feedback` once the new result comes back.
- Reuses `/api/pupil-submission/upload` (extend its allowed-extension list
  to include `.xlsx` for this activity type).

## Marking trigger — automatic, on submit/replace

On a successful upload (initial or replacement) and submission, the server:

1. Parses the `.xlsx` with `exceljs` into structured row/cell data.
2. Enqueues a row into `ai_marking_queue`, tagged with
   `activity_type: 'upload-spreadsheet'` so the queue processor can
   distinguish payload construction from `short-text-question`.

The existing queue processor (`src/app/api/marking/process-queue/route.ts`)
picks this up and calls `invokeAiMarking()`
(`src/lib/ai/ai-marking-client.ts`) with an extended payload:

```ts
{
  task: string,
  marking_guidance: string,
  spreadsheet_base64: string,                       // raw .xlsx, base64
  spreadsheet_data: { sheetName: string, rows: any[][] }[],
  webhook_url: string,
  group_assignment_id: string,
  activity_id: string,
  pupil_id: string,
  submission_id: string,
}
```

`spreadsheet_data` gives the AI agent structured cell values to reason over
directly; `spreadsheet_base64` is included for workflows that need to
re-parse, forward, or archive the original file.

## Marking response — reuse `/webhooks/ai-mark`

No new inbound webhook. Same payload shape and auth as today:

```ts
{
  group_assignment_id: string,
  activity_id: string,
  results: Array<{ pupil_id: string, score: number (0-1), feedback?: string }>
}
```

The route's activity-type allowlist (currently scoped to
`SHORT_TEXT_ACTIVITY_TYPE`) is extended to also accept
`upload-spreadsheet`, writing to `ai_model_score` / `ai_model_feedback` on
the matching submission the same way it does today.

## Display

In `activity-view/index.tsx`, add an `upload-spreadsheet` branch:

- Shows the task text.
- Shows the uploaded filename (and a re-upload control, pre-deadline).
- Once marked, shows score and AI feedback, following the
  `short-text-question` display pattern.

## Out of scope (YAGNI)

- In-browser spreadsheet preview, editing, or formula evaluation beyond what
  `exceljs` extracts as raw cell values.
- Multi-file upload per activity.
- Upload version history / diffing between replacements (only the latest
  file and latest AI result are kept).
