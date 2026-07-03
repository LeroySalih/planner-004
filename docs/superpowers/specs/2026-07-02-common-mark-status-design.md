# Common Mark Status — Design

**Date:** 2026-07-02
**Status:** Approved (pending spec review)

## Purpose

Give every AI-marked submission attempt a single, shared, real-time status so a
teacher can see where each attempt is in the pipeline: **waiting → reading →
marking → marked**, with distinct **reading-error** / **marking-error** states.
The same status vocabulary is used by the AI marking queue, and the status is
stored in **one** place (the submission), surfaced live via SSE in two UI
locations (the Automatic Score panel and each attempt row).

## Key Decisions

1. **One shared status vocabulary**, defined once and referenced everywhere
   (submission, queue, SSE, UI):
   `waiting | reading | marking | marked | reading-error | marking-error`.
2. **Single source of truth** = a real column `submissions.mark_status` (plus
   `submissions.mark_error` for the error message). Replaces the worksheet-only
   `body.ocr_status` / `body.ocr_error`.
3. **The AI queue drops its own status column.** `ai_marking_queue` keeps only
   its work mechanics (`submission_id`, `assignment_id`, `attempts`,
   `process_after`, `last_error`, timestamps). The queue reads/writes the
   submission's `mark_status`; there is no second status to diverge.
4. **Applies to all AI-marked types** — `upload-worksheet` (has the `reading`
   phase), `short-text-question`, `upload-spreadsheet` (no `reading`).
5. **Live** — every transition emits an SSE `submission.updated` event on the
   `submissions` topic carrying `markStatus` / `markError` / `markedAt`. The
   results dashboard already subscribes to `topics=submissions,assignments`.

## Status Vocabulary

Defined in `src/dino.config.ts` (next to the other activity constants) as a
frozen array + a TypeScript union + a Zod enum in `src/types/index.ts`.

| State | Meaning | Set when |
|---|---|---|
| `waiting` | queued in the AI marking queue, not yet picked up | enqueued for marking (incl. short-text debounce window) |
| `reading` | OCR in progress | worksheet, after upload, while the OCR flow runs |
| `marking` | AI marking in progress | queue has claimed the item and invoked marking |
| `marked` | complete | mark applied by the `ai-mark` callback (record `markedAt`) |
| `reading-error` | OCR failed | image-to-text could not read the images |
| `marking-error` | marking failed | invoke failed after retries / marking flow errored |

### Per-type lifecycle
- **Worksheet:** `reading` → `waiting` → `marking` → `marked`; OCR fail →
  `reading-error`; marking fail → `marking-error`.
- **Short-text:** `waiting` (debounced) → `marking` → `marked` / `marking-error`.
- **Spreadsheet:** `waiting` → `marking` → `marked` / `marking-error`.
- **Re-mark ("Mark with AI"):** current attempt returns to `waiting` → `marking`.
- **Re-upload / edit text:** a **new attempt** starting at `reading` (worksheet)
  or `waiting` (edited text goes straight to marking).

## Data Model & Migration

New migration in `src/migrations/`:
- `ALTER TABLE submissions ADD COLUMN mark_status text`, `ADD COLUMN mark_error text`.
- Index `submissions (mark_status)` — the queue claims on it.
- Backfill: rows with an applied AI mark (has `ai_marks`/`ai_model_score`) →
  `marked`; rows mid-flight with `body.ocr_status` → mapped value
  (`extracting`→`reading`, `marking`→`marking`, `marked`→`marked`,
  `error`→`reading-error` or `marking-error` best-effort); everything else →
  `null`.
- `ALTER TABLE ai_marking_queue DROP COLUMN status` (after the processor no longer
  references it).

The `body.ocr_status` / `body.ocr_error` fields are removed from the worksheet
schema and all writers; the pupil worksheet component reads `mark_status` instead.

## Queue Rewrite

Enqueue (worksheet OCR callback, short-text submit, spreadsheet upload, manual
re-mark): set `submissions.mark_status='waiting'` and insert/refresh the
`ai_marking_queue` row (`attempts=0`, `process_after`).

Claim (in `processNextQueueItem`):
```sql
UPDATE submissions SET mark_status='marking'
WHERE submission_id IN (
  SELECT q.submission_id FROM ai_marking_queue q
  JOIN submissions s ON s.submission_id = q.submission_id
  WHERE s.mark_status='waiting' AND q.process_after <= now()
  ORDER BY q.created_at LIMIT :batch
  FOR UPDATE OF q SKIP LOCKED
) RETURNING submission_id;
```
For each claimed submission, emit `marking` SSE and call `invokeAiMarking`.
- Invoke throws → increment `attempts`; if `< MAX_ATTEMPTS` set `mark_status='waiting'`
  + `process_after = now() + backoff`; else `mark_status='marking-error'`,
  `mark_error=<reason>`, delete the queue row.
- `ai-mark` callback applies the mark → `mark_status='marked'`, delete the queue row.

`triggerManualAiMarkingAction` sets the submission back to `waiting` and enqueues.

## Transitions & SSE

Every writer sets `mark_status` (and `mark_error` where relevant) and emits
`emitSubmissionEvent("submission.updated", { submissionId, activityId, markStatus, markError, markedAt })`:

| Trigger | New status |
|---|---|
| Worksheet upload route (after insert) | `reading` |
| Worksheet OCR read/invoke fail (upload route catch) | `reading-error` |
| image-to-text callback (transcript stored, enqueue marking) | `waiting` |
| image-to-text: submission not worksheet / bad body | `reading-error` |
| Short-text submit (enqueue, debounced) | `waiting` |
| Spreadsheet upload (enqueue) | `waiting` |
| Queue claims item | `marking` |
| Queue invoke throws (final) | `marking-error` |
| ai-mark callback applies mark | `marked` (+ `markedAt`) |
| Manual "Mark with AI" | `waiting` |
| Edit text (`editWorksheetTextAction`) new attempt | `waiting` |

## UI (2 locations)

Shared presentational helper maps a `mark_status` → chip label + colour:
`waiting → "Waiting…"`, `reading → "Reading…"`, `marking → "Marking…"`,
`marked → "Marked DD-MM-YYYY"`, `reading-error → "Reading error"` (+ tooltip
`mark_error`), `marking-error → "Marking error"` (+ tooltip). Dates render
DD-MM-YYYY per project convention.

1. **Automatic Score panel** (`assignment-results-dashboard.tsx`, the box with
   "… Auto / MARK WITH AI"): a status chip for the *current* selected attempt,
   updated live via SSE.
2. **Each attempt row** (both Attempts-tab layouts in the same file): a status
   chip per attempt derived from that attempt's `mark_status`, updated live via
   SSE (the dashboard updates its `attempts`/matrix state on `submission.updated`).

The pupil worksheet component keeps its existing status display but reads the new
`mark_status` values (`reading`/`waiting`/`marking`/`marked`/`reading-error`).

## Error Handling

- `reading-error` / `marking-error` store a human message in `mark_error`, shown
  in the attempt chip tooltip and the panel.
- Stale/late callbacks are harmless: status is keyed to a specific submission
  (attempt) id, and re-marks/edits create new attempts.

## Testing

- `pnpm build` (type-check) is the gate; `pnpm lint` is broken repo-wide.
- Migration applied to the worktree DB; verify column + backfill.
- `curl` the `image-to-text` and `ai-mark` callbacks to drive status transitions
  and assert `submissions.mark_status` moves correctly.
- Manual check in the dashboard: upload → chip goes Reading → Waiting → Marking →
  Marked live; force an error and see reading-error/marking-error.

## Out of Scope

- Non-AI-marked types (MCQ, matcher, group-items) — scored on submit, no status.
- Changing the marking prompt / n8n workflows.
