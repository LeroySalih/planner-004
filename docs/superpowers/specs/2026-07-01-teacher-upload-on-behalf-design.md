# Teacher Upload-on-Behalf via Pupil Response Drop Target

**Date:** 2026-07-01
**Status:** Approved (design)

## Problem

In the assignment-results dashboard (`/results/assignments/[...]`), when a teacher
selects a pupil's cell for an upload activity, the marking panel shows a **Pupil
response** box. If the pupil has not submitted, it reads "No upload has been
submitted yet" and the teacher has no way to add the pupil's work themselves.

Teachers need to be able to upload a file on a pupil's behalf — for example when a
pupil hands in physical/offline work, or emails a screenshot. The uploaded file
must be recorded **as if the pupil had submitted it themselves**, so that the
existing submission lifecycle (storage, scoring, AI marking, SSE updates) runs
unchanged.

## Goals

- Make the **Pupil response** box in the marking panel a drag-and-drop target for
  teachers, plus a click-to-browse file selector for when drag-and-drop is
  inconvenient.
- On drop/select, the file is processed through **exactly the same flow a pupil
  upload would trigger** for that activity type — no new AI behaviour.
- Support all three upload activity types: `upload-file`, `upload-spreadsheet`,
  `upload-worksheet`.

## Non-Goals

- No new AI marking path for `upload-file`. It mirrors the pupil flow exactly:
  store + create submission, no AI marking (only `upload-spreadsheet` /
  `upload-worksheet` auto-enqueue AI marking, and they keep doing so).
- No changes to pupil-facing upload UI.

## Decisions (from brainstorming)

- **"Sent to the AI flow" = mirror the pupil flow exactly.** `upload-file` =
  store + create submission only; `upload-worksheet` / `upload-spreadsheet` =
  store + create + auto AI-mark (their routes already enqueue marking when a
  `groupAssignmentId` is present).
- **All three upload types** supported.
- **Extend the existing pupil-submission routes** rather than add teacher-only
  routes.
- **Extract one shared client dropzone component** used by both marking panels,
  rather than inlining duplicate handlers.
- **Include a click-to-browse file selector** in addition to the drop zone.

## Current Architecture (as found)

- `PupilUploadActivity` (`src/components/pupil/pupil-upload-activity.tsx`) posts
  multipart `FormData` (`lessonId`, `activityId`, `pupilId`, `file`) to
  `POST /api/pupil-submission/upload`.
- The three routes under `src/app/api/pupil-submission/`:
  - `upload/route.ts` — stores file, versions duplicates, inserts a `submissions`
    row owned by the pupil, emits SSE `submission.uploaded`. **No AI marking.**
  - `upload-worksheet/route.ts` and `upload-spreadsheet/route.ts` — same, **plus**
    `enqueueMarkingTasks(groupAssignmentId, [{ submissionId }])` +
    `triggerQueueProcessor()` when a `groupAssignmentId` form field is present.
- All three currently block teachers with `if (profile.userId !== pupilId) return
  403`.
- The marking queue's `SUPPORTED_TYPES` is `short-text-question`,
  `upload-spreadsheet`, `upload-worksheet` — `upload-file` is intentionally not
  auto-marked.
- `src/lib/auth.ts` exposes `getAuthenticatedProfile()` (returns `{ userId,
  email, roles, ... }`) and `hasRole(profile, role)`.
- The dashboard (`src/components/assignment-results/assignment-results-dashboard.tsx`,
  ~4,180 lines) renders the **Pupil response** + **Uploaded files** content twice:
  a desktop `<aside>` (~line 2405) and a mobile `<Sheet>` (~line 3431). Both gate
  upload content on `isUploadListingActivityType(selection.activity.type)`.
  `handleUploadRefresh` already exists to re-fetch the uploads list, and the SSE
  handler already updates the matrix cell on `submission.uploaded`.
- `matrixState.assignmentId` is the group-assignment id available in the dashboard
  (used as `groupAssignmentId` for AI-mark enqueue).

## Server-Side Design

Extend each of the three routes (`upload`, `upload-spreadsheet`, `upload-worksheet`):

1. **Auth:** after loading `profile`, allow when
   `profile.userId === pupilId` **OR** `hasRole(profile, "teacher")`. Otherwise
   return the existing 403.
2. **Ownership & storage key derived from `pupilId` (not the uploader):**
   - Submission `user_id = pupilId` (already the case for self-upload).
   - `pupilStorageKey = await resolvePupilStorageKey(pupilId)` — drop the
     `profile.email?.trim() ?? …` shortcut, because for a self-upload it resolves
     to the same email, and for a teacher upload it must be the *pupil's* key.
   - This makes the teacher-created submission byte-for-byte indistinguishable
     from a pupil's own (same storage path, same `submissions.user_id`).
3. **Audit:** keep `uploadedBy: profile.userId` in the storage metadata so the
   real uploader is still recorded.
4. Everything else unchanged: duplicate-versioning, `getNextAttemptNumber`,
   `clearResubmitRequest`, `logActivitySubmissionEvent`, SSE emit, and (for
   worksheet/spreadsheet) the `groupAssignmentId`-keyed AI-mark enqueue.

The internal `userId` constant in each route, currently `= profile.userId`, becomes
the pupil owner id (`= pupilId`); a separate `uploaderId = profile.userId` is used
only for the storage `uploadedBy` field.

## Client-Side Design

New component `TeacherSubmissionDropzone`
(`src/components/assignment-results/teacher-submission-dropzone.tsx`, `"use client"`):

**Props:** `lessonId`, `activityId`, `activityType`, `pupilId`, `assignmentId`,
`onUploaded` (callback), `disabled?`, plus `children` (the existing Pupil response
content rendered inside the drop target).

**Behaviour:**
- Wraps its `children` in a div with `onDragOver` / `onDragEnter` / `onDragLeave` /
  `onDrop` handlers and drag-active styling (border + subtle background), mirroring
  the pupil component's dropzone styling.
- Renders a small "Choose file" link/button below the content that opens a hidden
  `<input type="file">` — the click-to-browse fallback.
- On drop or file selection, takes the first file, builds `FormData`
  (`lessonId`, `activityId`, `pupilId`, `file`, and `groupAssignmentId =
  assignmentId` for `upload-spreadsheet` / `upload-worksheet`), and POSTs to the
  endpoint selected by `activityType`:
  - `upload-file` → `/api/pupil-submission/upload`
  - `upload-spreadsheet` → `/api/pupil-submission/upload-spreadsheet`
  - `upload-worksheet` → `/api/pupil-submission/upload-worksheet`
- Uses a synchronous in-progress ref guard (same pattern as `PupilUploadActivity`)
  to prevent duplicate concurrent uploads.
- On success: `toast.success`, then call `onUploaded()`.
- On failure: `toast.error` with the route's error; panel stays interactive for
  retry.

**Integration:** both marking panels (desktop aside ~2405, mobile Sheet ~3431)
wrap their **Pupil response** box with `TeacherSubmissionDropzone` when
`isUploadListingActivityType(selection.activity.type)` is true, passing
`onUploaded={handleUploadRefresh}`. The SSE `submission.uploaded` event updates the
matrix cell automatically; `handleUploadRefresh` refreshes the Uploaded files list.

## Data Flow

```
Teacher drops/selects file on Pupil response box
  → TeacherSubmissionDropzone POSTs FormData to type-specific route
  → route: authorize (self OR teacher)
         → store file under PUPIL's storage path
         → insert submissions row with user_id = pupilId
         → (worksheet/spreadsheet) enqueueMarkingTasks + triggerQueueProcessor
         → emit SSE submission.uploaded
  → dashboard: SSE updates matrix cell; onUploaded() refreshes Uploaded files list
```

## Error Handling

Reuse existing route responses: `401` unauthenticated, `403` not self / not
teacher, `413` file > 5 MB, `500` storage/DB failure — all `{ success, error }`.
Client surfaces via `sonner` toast and leaves the dropzone interactive.

## Testing

Playwright E2E (repo has no unit-test infra). New spec under `tests/`: signed in as
a teacher, open the assignment-results dashboard, select a pupil cell for an upload
activity with no submission, drop/select a file on the Pupil response panel, assert
the file appears in the Uploaded files list.

## Files Touched

- `src/app/api/pupil-submission/upload/route.ts` — auth + pupil-derived ownership.
- `src/app/api/pupil-submission/upload-spreadsheet/route.ts` — same.
- `src/app/api/pupil-submission/upload-worksheet/route.ts` — same.
- `src/components/assignment-results/teacher-submission-dropzone.tsx` — new shared
  component.
- `src/components/assignment-results/assignment-results-dashboard.tsx` — wrap both
  Pupil response panels with the dropzone.
- `tests/…` — new Playwright spec.
