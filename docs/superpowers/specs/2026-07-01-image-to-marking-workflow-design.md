# Image → AI Marking Workflow — Design

**Date:** 2026-07-01
**Status:** Approved (pending spec review)

## Purpose

Let pupils answer an **Upload Exam Question** activity by uploading one or more
photos of handwritten work. The images are transcribed to text, the text is
marked by AI against the usual marking guidance, and the result + score are
stored as an attempt. Teachers can review the original images alongside the
extracted text and correct OCR misreads.

## Key Decisions

1. **Dino is the orchestrator/hub.** Dino owns the submission, decides the path,
   calls the n8n workflows, receives their callbacks, holds all state, and drives
   the UI. n8n does not orchestrate n8n.
2. **Two independent, single-purpose n8n workflows**, each with its own webhook
   and each stateless (input → do one job → call back):
   - **Image → Pupil Submission** (OCR): images in, transcribed text out.
   - **AI Marking**: text + guidance in, score + feedback out.
3. **Marking is reusable.** It is called identically whether the text came from
   OCR or was typed directly. Typed activities skip OCR entirely.
4. **Async with callback.** Dino fires a request; the workflow does the work in
   the background and POSTs results back to a dino endpoint. UI updates via
   polling/realtime, matching the existing `fast-ui` async pattern.
5. **Faithful transcription — no autocorrect.** The OCR workflow must transcribe
   exactly what the pupil wrote, preserving spelling, grammar, and SPAG errors,
   because SPAG is part of what is being marked.
6. **Auto-send with optional edits.** OCR text is sent to marking automatically
   on receipt (capturing raw pupil work). Corrections trigger a fresh run:
   - **Pupil** fixes their own work → re-uploads images → new OCR → new marking.
   - **Teacher** fixes an OCR misread → edits text → re-marking (no re-OCR).
7. **Store the images.** Uploaded images are persisted auth-gated (never in
   `public/`), linked to the attempt, and shown on both the pupil activity and
   the teacher results/feedback page next to the OCR text.
8. **Each marking run = a new attempt.** Full history is preserved; the activity
   shows the latest. `jobId` = the attempt id.

## Architecture

Three actors, two n8n workflows:

- **Dino server** — orchestrator + state. Receives the submission, picks the
  path, calls the right webhook(s), receives callbacks, persists images /
  extracted text / marks, drives the UI.
- **Image → Pupil Submission workflow (n8n)** — webhook in: image files +
  `jobId` + `callbackUrl`. Transcribes images → text (faithfully). Callback out:
  posts extracted text to dino. Knows nothing about marking.
- **AI Marking workflow (n8n)** — webhook in: plain text + `guidance` + `jobId`
  + `callbackUrl`. Runs AI marking. Callback out: posts score + feedback to dino.
  Knows nothing about images or OCR.

## Data Flow

### Image path (Upload Exam Question)

1. Pupil uploads N files → dino server action. Dino stores the images, creates an
   **attempt** in state `extracting`, and POSTs to the OCR webhook:
   `{ jobId, callbackUrl, files[] }` (multipart).
2. OCR workflow transcribes faithfully → callback to dino: `{ jobId, text }`.
   Dino stores text on the attempt (`extracted`) and **auto-forwards** to marking.
3. Dino POSTs to the AI Marking webhook:
   `{ jobId, text, guidance }` where `guidance` = success criteria, model answer,
   max marks (the usual marking payload). Attempt → `marking`.
4. Marking workflow → callback to dino: `{ jobId, score, feedback, breakdown }`.
   Dino stores the result on the attempt (`marked`). UI updates.

### Typed path (other activities)

Dino skips straight to step 3 (marking called directly with typed text).

### Re-mark

- Pupil re-upload → new attempt, full image path from step 1.
- Teacher edit of extracted text → new attempt starting at step 3 (marking only,
  no re-OCR).

## Contracts

**Dino → OCR webhook** (multipart): `jobId`, `callbackUrl`, `files[]`.
**OCR → dino callback** (JSON): `{ jobId, text }`.
**Dino → Marking webhook** (JSON): `{ jobId, text, guidance }`.
**Marking → dino callback** (JSON): `{ jobId, score, feedback, breakdown }`.

Exact field shapes for `guidance` and `breakdown` align with existing marking /
scoring conventions and are finalised in the implementation plan.

## Attempt State Machine

`extracting → extracted → marking → marked`, with a terminal `error` reachable
from any step. UI renders off this state: spinner during in-flight states, retry
on `error`, score + feedback on `marked`.

## Error Handling

- **OCR fails / times out** → attempt → `error`; pupil sees "couldn't read
  images, try re-uploading."
- **Marking fails / times out** → attempt → `error`; retry re-fires marking
  against the same extracted text (no re-OCR).
- **Partial OCR** (one of N images unreadable) → return what was read; teacher
  can correct.
- **Stale callbacks** — because `jobId` = attempt id and each re-mark is a new
  attempt, a late callback from a superseded run lands on its own old attempt and
  cannot clobber the current one. No extra locking required.

## Security

- The two dino callback endpoints are called by n8n, not a logged-in user, so
  they cannot use the normal session guard. They are protected by a shared secret
  (`N8N_CALLBACK_SECRET` in `.env`, sent as a header and verified, or an HMAC over
  the body). Per project security policy, this secret lives only in `.env`.
- Uploaded pupil images are stored auth-gated (never `public/`).

## Open Implementation Decisions (for the plan)

- **New activity type** `upload-exam-question` (scorable) registered in
  `src/dino.config.ts`; how it slots into `SCORABLE_ACTIVITY_TYPES` and
  `compute_submission_base_score`.
- **Image store**: DB bytea vs. object bucket, and the auth-gated serving route.
- **UI update mechanism**: polling vs. realtime for attempt-state changes.
- Exact `guidance` / `breakdown` field shapes.
