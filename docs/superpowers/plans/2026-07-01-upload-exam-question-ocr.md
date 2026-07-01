# Upload Exam Question (OCR → Editable Text → Mark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the existing `upload-worksheet` activity ("Upload Exam Question") so a pupil uploads multiple images, an n8n OCR workflow transcribes them to editable text, that text is auto-sent to the existing AI marking flow, and the result is stored as an attempt — with edits (pupil re-upload or teacher OCR-fix) producing new attempts.

**Architecture:** Dino is the orchestrator. Two n8n workflows, each stateless request-with-callback: (1) **Image → Pupil Submission** (OCR) — NEW; (2) **AI Marking** — ALREADY EXISTS and is reused. Dino stores images, holds an `ocr_status` state machine in `submissions.body`, calls OCR, receives the transcript on a new callback route, then hands the text to the existing `enqueueMarkingTasks` pipeline. UI updates via existing SSE topics.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, PostgreSQL via `pg`, Zod, existing SSE hub (`src/lib/sse/*`), Playwright for E2E. n8n workflows are configured in the n8n UI (out of repo) — this plan defines their HTTP contract only.

## Global Constraints

- **Two-space indentation** throughout.
- **Server actions / routes** validate input with Zod and return `{ data, error }` or the route's existing JSON shape; wrap DB access in try/catch.
- **All secrets live in `.env` only** — never hardcode. New secrets generated with `openssl rand -hex 20`. Reference in code via `process.env`.
- **Faithful OCR** — the OCR n8n workflow must transcribe exactly what the pupil wrote (preserve spelling/grammar/SPAG); no autocorrect. This is enforced in the n8n prompt (documented in Task 10), not in dino code.
- **No backwards-compatibility hacks in code** — delete replaced code, don't comment it out. (Old *data* rows with the legacy single-file `filePath`/`fileName` shape must still be readable, so those two fields stay optional in the schema — that is data compatibility, not a code hack.)
- **Activity type identifier stays `upload-worksheet`.** Only its display label changes to "Upload Exam Question".
- **Scoring** — never write ad-hoc COALESCE chains; the existing marking pipeline already uses `compute_submission_base_score` / `compute_submission_marks`. Do not touch scoring SQL.
- **No unit-test runner exists** in this repo (Playwright E2E only). Verification per task uses `pnpm lint`, `pnpm build` (type-check), `curl` against the dev server for HTTP endpoints, and a Playwright spec for the end-to-end flow. Do **not** introduce a new unit-test framework.
- **Work happens in an isolated worktree** with its own database (see Pre-Task Setup).

---

## Pre-Task Setup (worktree + env)

Before Task 1, create an isolated worktree and database, and add the new env vars.

- [ ] **Step 1: Create the worktree with an isolated DB and dev server**

Run:
```bash
git worktree add .worktrees/exam-question-ocr -b feature/exam-question-ocr
./scripts/setup-worktree-db.sh exam-question-ocr --start-server
```
Expected: a `postgres-exam-question-ocr` database is created, `.env` is copied into the worktree, and a dev server starts in tmux session `worktree-exam-question-ocr` on a port ≥3001. Note the port (call it `$PORT`) from `tmux attach -t worktree-exam-question-ocr` (Ctrl-b then d to detach).

- [ ] **Step 2: Add new env vars to the worktree `.env`**

Generate secrets and append to `.worktrees/exam-question-ocr/.env`:
```bash
echo "N8N_OCR_WEBHOOK_URL=https://n8n.mr-salih.org/webhook/10858f88-71fe-48b2-bca6-e2d321f98f37" >> .worktrees/exam-question-ocr/.env
echo "N8N_OCR_AUTH=$(openssl rand -hex 20)" >> .worktrees/exam-question-ocr/.env
echo "IMAGE_OCR_SERVICE_KEY=$(openssl rand -hex 20)" >> .worktrees/exam-question-ocr/.env
```
Expected: three new lines present. `N8N_OCR_WEBHOOK_URL` is the OCR workflow's webhook (test URL for now; swap to the `/webhook/` production path once the workflow is activated). `N8N_OCR_AUTH` is sent to n8n as a header; `IMAGE_OCR_SERVICE_KEY` is the secret n8n must send back on the callback.

All subsequent tasks run inside `.worktrees/exam-question-ocr`.

---

## File Structure

**New files:**
- `src/lib/ai/ocr-client.ts` — outbound call to the OCR n8n workflow (`invokeImageOcr`).
- `src/app/webhooks/image-to-text/route.ts` — inbound OCR callback (writes transcript, enqueues marking).
- `tests/worksheets/exam-question-ocr.spec.ts` — Playwright E2E for the full flow.
- `docs/n8n/image-to-pupil-submission-workflow.md` — the OCR workflow HTTP contract + faithful-transcription prompt.

**Modified files:**
- `src/dino.config.ts` — display label map for `upload-worksheet` → "Upload Exam Question" (if a label map exists; otherwise label lives where the explorer found the string).
- `src/types/index.ts` — `UploadWorksheetSubmissionBodySchema` gains `images[]`, `extractedText`, `ocr_status`, `ocr_error`.
- `src/app/api/pupil-submission/upload-worksheet/route.ts` — accept multiple files, store all, create submission in `extracting`, trigger OCR instead of marking.
- `src/lib/ai/ai-marking-client.ts` — `WorksheetMarkingParams`: replace `WORKSHEET_IMAGE` with `extracted_text`.
- `src/lib/ai/marking-queue.ts` — worksheet branch: send `extracted_text` from the submission body instead of base64 image.
- `src/components/pupil/pupil-upload-worksheet-activity.tsx` — multi-file upload + editable-text checkpoint UI + SSE-driven state.
- `src/lib/server-actions/submissions.ts` (or a focused new action file) — `editWorksheetTextAction` (new attempt + re-mark).
- `src/components/assignment-results/assignment-results-dashboard.tsx` — teacher view: show all images + OCR text + edit/re-mark.
- `src/lib/scoring/activity-scores.ts` — worksheet `pupilAnswer` extraction uses `extractedText` when present.

---

## Task 1: Submission body schema + display label

**Files:**
- Modify: `src/types/index.ts` (the `UploadWorksheetSubmissionBodySchema` block, ~lines 646-659)
- Modify: `src/dino.config.ts` (display-label location found by exploration)

**Interfaces:**
- Produces: `UploadWorksheetSubmissionBodySchema` with new fields `images: Array<{ filePath: string; fileName: string }>`, `extractedText: string | null`, `ocr_status: "extracting" | "extracted" | "marking" | "marked" | "error"`, `ocr_error: string | null`. Legacy `filePath`/`fileName` become optional (read-only for old rows).

- [ ] **Step 1: Update the Zod schema**

Replace the current `UploadWorksheetSubmissionBodySchema` in `src/types/index.ts` with:
```typescript
export const WorksheetImageSchema = z.object({
  filePath: z.string().min(1),
  fileName: z.string().min(1),
});
export type WorksheetImage = z.infer<typeof WorksheetImageSchema>;

export const WorksheetOcrStatusSchema = z.enum([
  "extracting",
  "extracted",
  "marking",
  "marked",
  "error",
]);
export type WorksheetOcrStatus = z.infer<typeof WorksheetOcrStatusSchema>;

export const UploadWorksheetSubmissionBodySchema = z
  .object({
    images: z.array(WorksheetImageSchema).default([]),
    extractedText: z.string().nullable().default(null),
    ocr_status: WorksheetOcrStatusSchema.default("extracting"),
    ocr_error: z.string().nullable().optional(),
    // Legacy single-file fields — kept optional so old attempts still parse.
    filePath: z.string().optional(),
    fileName: z.string().optional(),
    // Marking fields (written by applyAiMarkToSubmission — unchanged).
    ai_model_score: z.number().min(0).max(1).nullable().optional(),
    ai_model_feedback: z.string().nullable().optional(),
    teacher_override_score: z.number().min(0).max(1).nullable().optional(),
    is_correct: z.boolean().default(false),
    teacher_feedback: z.string().nullable().optional(),
    success_criteria_scores: z
      .record(z.string(), z.number().min(0).max(1).nullable())
      .default({}),
    ai_marks: z.number().int().min(0).nullable().optional(),
    teacher_ai_marks: z.number().int().min(0).nullable().optional(),
    marks_override: z.number().int().min(0).nullable().optional(),
  })
  .passthrough();
```

- [ ] **Step 2: Update the display label**

In `src/dino.config.ts` (or the label map exploration identified), set the human-readable label for `upload-worksheet` to `"Upload Exam Question"`. If the label currently lives as a hard-coded string in `src/components/lessons/activity-view/index.tsx` (`"Upload exam question"`), leave that — it already matches; only change a central label map if one exists.

- [ ] **Step 3: Type-check**

Run: `pnpm build`
Expected: build succeeds. If it fails, the failures point to every call site that reads `body.fileName`/`body.filePath` — note them; they are handled in Tasks 4, 8, 9.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/dino.config.ts
git commit -m "feat: worksheet submission body gains images[], extractedText, ocr_status"
```

---

## Task 2: OCR outbound client

**Files:**
- Create: `src/lib/ai/ocr-client.ts`

**Interfaces:**
- Consumes: env `N8N_OCR_WEBHOOK_URL`, `N8N_OCR_AUTH`.
- Produces: `invokeImageOcr(params: ImageOcrParams): Promise<void>` and type `ImageOcrParams = { submission_id: string; activity_id: string; pupil_id: string; webhook_url: string; images: Array<{ url: string; fileName: string }> }`.

- [ ] **Step 1: Write the client**

Create `src/lib/ai/ocr-client.ts`:
```typescript
export interface ImageOcrParams {
  submission_id: string;
  activity_id: string;
  pupil_id: string;
  webhook_url: string;
  group_assignment_id?: string;
  images: Array<{ url: string; fileName: string }>;
}

/**
 * Fire-and-forget call to the n8n "Image -> Pupil Submission" (OCR) workflow.
 * n8n transcribes the images faithfully and POSTs the text back to webhook_url.
 */
export async function invokeImageOcr(params: ImageOcrParams): Promise<void> {
  const url = process.env.N8N_OCR_WEBHOOK_URL;
  const auth = process.env.N8N_OCR_AUTH;

  if (!url) {
    throw new Error("N8N_OCR_WEBHOOK_URL is not configured.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    headers["x-ocr-key"] = auth;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`n8n OCR webhook request failed (${response.status}): ${errorText}`);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm build`
Expected: build succeeds (file is not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/ocr-client.ts
git commit -m "feat: add invokeImageOcr client for n8n OCR workflow"
```

---

## Task 3: OCR callback route

**Files:**
- Create: `src/app/webhooks/image-to-text/route.ts`

**Interfaces:**
- Consumes: env `IMAGE_OCR_SERVICE_KEY`; `enqueueMarkingTasks` from `src/lib/ai/marking-queue.ts`; `triggerQueueProcessor` (same module, used by the worksheet upload route); `emitSubmissionEvent` from `src/lib/sse/topics.ts`; `query` from `src/lib/db.ts`; `UploadWorksheetSubmissionBodySchema` from `src/types/index.ts`.
- Produces: `POST /webhooks/image-to-text` accepting `{ submission_id: string, text: string, group_assignment_id?: string }`; auth header `image-ocr-service-key`.

- [ ] **Step 1: Write the route**

Create `src/app/webhooks/image-to-text/route.ts`. Mirror the auth + parse pattern from `src/app/webhooks/ai-mark/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { UploadWorksheetSubmissionBodySchema } from "@/types";
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue";
import { emitSubmissionEvent } from "@/lib/sse/topics";

const PayloadSchema = z.object({
  submission_id: z.string().min(1),
  text: z.string(),
  group_assignment_id: z.string().min(3).optional(),
});

export async function POST(request: Request) {
  const tag = "[image-to-text-webhook]";
  const expected = process.env.IMAGE_OCR_SERVICE_KEY;
  if (!expected || expected.trim().length === 0) {
    return NextResponse.json({ error: "OCR webhook is not configured." }, { status: 500 });
  }
  const inbound =
    request.headers.get("image-ocr-service-key") ?? request.headers.get("Image-Ocr-Service-Key");
  if (!inbound || inbound.trim() !== expected.trim()) {
    console.warn(`${tag} Unauthorized OCR callback.`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const { submission_id, text, group_assignment_id } = parsed.data;

  const { rows } = await query<{ body: unknown; activity_id: string }>(
    `select body, activity_id from submissions where submission_id = $1 limit 1`,
    [submission_id],
  );
  const row = rows?.[0];
  if (!row) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const currentBody = UploadWorksheetSubmissionBodySchema.parse(row.body ?? {});
  const nextBody = UploadWorksheetSubmissionBodySchema.parse({
    ...currentBody,
    extractedText: text,
    ocr_status: "marking",
    ocr_error: null,
  });
  await query(`update submissions set body = $1 where submission_id = $2`, [
    nextBody,
    submission_id,
  ]);

  void emitSubmissionEvent("submission.updated", {
    submissionId: submission_id,
    activityId: row.activity_id,
    ocrStatus: "marking",
  });

  // Auto-forward the transcript to the existing marking pipeline.
  if (group_assignment_id) {
    try {
      await enqueueMarkingTasks(group_assignment_id, [{ submissionId: submission_id }]);
      await triggerQueueProcessor();
    } catch (err) {
      console.error(`${tag} Failed to enqueue marking (non-fatal)`, err);
    }
  } else {
    console.warn(`${tag} No group_assignment_id — text stored but marking not enqueued`, {
      submission_id,
    });
  }

  return NextResponse.json({ success: true });
}
```

Note: if `triggerQueueProcessor` is not exported from `marking-queue.ts`, check the worksheet upload route's import (exploration confirmed it calls both `enqueueMarkingTasks` and `triggerQueueProcessor`) and import from the same path.

- [ ] **Step 2: Verify auth rejection with curl**

With the dev server running on `$PORT`, run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:$PORT/webhooks/image-to-text" \
  -H "Content-Type: application/json" \
  -d '{"submission_id":"nope","text":"hi"}'
```
Expected: `401` (missing `image-ocr-service-key` header).

- [ ] **Step 3: Verify not-found with a valid key**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:$PORT/webhooks/image-to-text" \
  -H "Content-Type: application/json" \
  -H "image-ocr-service-key: $(grep '^IMAGE_OCR_SERVICE_KEY=' .env | cut -d= -f2)" \
  -d '{"submission_id":"does-not-exist","text":"hi"}'
```
Expected: `404` (auth passed, submission absent).

- [ ] **Step 4: Commit**

```bash
git add src/app/webhooks/image-to-text/route.ts
git commit -m "feat: add image-to-text OCR callback route (auth + enqueue marking)"
```

---

## Task 4: Multi-image upload route

**Files:**
- Modify: `src/app/api/pupil-submission/upload-worksheet/route.ts`

**Interfaces:**
- Consumes: `invokeImageOcr` (Task 2); `UploadWorksheetSubmissionBodySchema` (Task 1); existing `getPupilActivitySubmissionUrlAction` or the storage client already used in this route for building image URLs.
- Produces: same route path, now accepting form field `files` (repeatable) instead of a single `file`; creates the submission in `ocr_status: "extracting"` and calls `invokeImageOcr` instead of `enqueueMarkingTasks`.

- [ ] **Step 1: Accept and store multiple files**

In the route, replace the single-file read with a loop over all `files` form entries. Reuse the existing per-file validation (10MB cap, JPEG/PNG, the existing storage-path builder) for each. Collect into `const images: Array<{ filePath: string; fileName: string }> = []`. Keep the existing storage client and path pattern `lessons/{lessonId}/activities/{activityId}/{pupilStorageKey}/{fileName}`.

```typescript
const formData = await request.formData();
const files = formData.getAll("files").filter((f): f is File => f instanceof File);
if (files.length === 0) {
  return NextResponse.json({ success: false, error: "No files provided." }, { status: 400 });
}

const images: Array<{ filePath: string; fileName: string }> = [];
for (const file of files) {
  // ... existing size/type validation applied per file (return 400 on failure) ...
  const fileName = /* existing sanitised name logic */;
  const path = /* existing storage-path builder */;
  await storage.upload(path, file); // existing upload call
  images.push({ filePath: path, fileName });
}
```

- [ ] **Step 2: Create submission in `extracting` and trigger OCR**

Replace the submission-body construction and the `enqueueMarkingTasks` block with:
```typescript
const submissionBody = UploadWorksheetSubmissionBodySchema.parse({
  images,
  extractedText: null,
  ocr_status: "extracting",
  ocr_error: null,
  is_correct: false,
  success_criteria_scores: {},
});

const attemptNumber = await getNextAttemptNumber(activityId, userId);
const { rows: newRows } = await client.query(
  `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
   values ($1, $2, $3, $4, $5, 'submitted')
   returning submission_id`,
  [activityId, userId, attemptNumber, submissionBody, submittedAt],
);
const submissionId = newRows[0]?.submission_id ?? null;

if (submissionId) {
  const callbackBase = (process.env.AI_MARKING_CALLBACK_URL ?? "").replace(/\/$/, "");
  const imageUrls = await Promise.all(
    images.map(async (img) => ({
      url: await buildSignedImageUrl(lessonId, activityId, userId, img.fileName), // reuse existing URL builder
      fileName: img.fileName,
    })),
  );
  try {
    await invokeImageOcr({
      submission_id: submissionId,
      activity_id: activityId,
      pupil_id: userId,
      webhook_url: `${callbackBase}/webhooks/image-to-text`,
      images: imageUrls,
    });
  } catch (err) {
    console.error(`${tag} OCR invoke failed`, err);
    const errBody = UploadWorksheetSubmissionBodySchema.parse({
      ...submissionBody,
      ocr_status: "error",
      ocr_error: "Could not read images. Please try re-uploading.",
    });
    await client.query(`update submissions set body = $1 where submission_id = $2`, [
      errBody,
      submissionId,
    ]);
  }
}
```
`buildSignedImageUrl` = whichever URL/download helper this route or `getPupilActivitySubmissionUrlAction` already uses; if OCR needs auth-gated access, pass a short-lived signed URL. If the storage is local and n8n cannot reach it, fall back to sending base64 per image in `invokeImageOcr` (adjust `ImageOcrParams` accordingly) — decide based on the storage client's capabilities. Also pass `group_assignment_id` through to the OCR call if the workflow should echo it back; otherwise store it on the submission body so the callback can enqueue marking. **Simplest: include `group_assignment_id` in the `invokeImageOcr` payload and have n8n echo it in the callback.** Add it to `ImageOcrParams` and the callback `PayloadSchema` (already optional in Task 3).

- [ ] **Step 3: Remove the old single-file marking trigger**

Delete the `enqueueMarkingTasks(groupAssignmentId, [{ submissionId }])` block from this route (marking now fires from the OCR callback in Task 3). Do not comment it out — delete it.

- [ ] **Step 4: Type-check and lint**

Run: `pnpm build && pnpm lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pupil-submission/upload-worksheet/route.ts src/lib/ai/ocr-client.ts
git commit -m "feat: worksheet upload accepts multiple images and triggers OCR"
```

---

## Task 5: Marking sends extracted text, not the image

**Files:**
- Modify: `src/lib/ai/ai-marking-client.ts` (`WorksheetMarkingParams`)
- Modify: `src/lib/ai/marking-queue.ts` (worksheet branch, ~lines 337-351)

**Interfaces:**
- Produces: `WorksheetMarkingParams` where `WORKSHEET_IMAGE: string` is replaced by `extracted_text: string`.

- [ ] **Step 1: Update the params type**

In `src/lib/ai/ai-marking-client.ts`, change `WorksheetMarkingParams`:
```typescript
export interface WorksheetMarkingParams {
  task: string;
  marking_guidance: string;
  extracted_text: string;
  webhook_url?: string;
  group_assignment_id?: string;
  activity_id?: string;
  pupil_id?: string;
  submission_id?: string;
}
```

- [ ] **Step 2: Update the queue worksheet branch**

In `src/lib/ai/marking-queue.ts`, in the `upload-worksheet` branch, remove the base64 image loading (`worksheetImageBase64`) and read the transcript from the submission body instead:
```typescript
const parsedSubmissionBody = UploadWorksheetSubmissionBodySchema.parse(context.submission_body ?? {});
const resolvedMarkingGuidance = await resolveUploadWorksheetMarkingGuidance(
  parsedActivity.markingGuidance,
  parsedActivity.markingGuidanceId,
);
const doParams = {
  task: parsedActivity.task,
  marking_guidance: resolvedMarkingGuidance,
  extracted_text: parsedSubmissionBody.extractedText ?? "",
  webhook_url: effectiveCallbackUrl,
  group_assignment_id: item.assignment_id,
  activity_id: context.activity_id as string,
  pupil_id: context.pupil_id as string,
  submission_id: item.submission_id,
};
```
Delete the now-unused base64 image-loading code in this branch (do not comment it out). Add the `UploadWorksheetSubmissionBodySchema` import if not present. When the queue marks the item as processing/marked, ensure the submission `ocr_status` reads `marked` after `applyAiMarkToSubmission` runs — set `ocr_status: "marked"` in `applyAiMarkToSubmission` for `upload-worksheet` (Task 9 handles the SSE; here just persist the status alongside the marks).

- [ ] **Step 3: Set ocr_status to marked when marks are applied**

In `src/app/webhooks/ai-mark/route.ts` `applyAiMarkToSubmission`, when `activityType === "upload-worksheet"`, include `ocr_status: "marked"` in the `nextBody` it writes. (The schema already carries the field; just spread it in.)

- [ ] **Step 4: Type-check and lint**

Run: `pnpm build && pnpm lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ai-marking-client.ts src/lib/ai/marking-queue.ts src/app/webhooks/ai-mark/route.ts
git commit -m "feat: worksheet marking sends extracted_text and finalises ocr_status"
```

---

## Task 6: Pupil multi-image upload + editable-text checkpoint UI

**Files:**
- Modify: `src/components/pupil/pupil-upload-worksheet-activity.tsx`

**Interfaces:**
- Consumes: the upload route (Task 4) with repeatable `files` field; SSE topic `submissions` for `ocr_status` updates; `editWorksheetTextAction` (Task 7) for saving edits.

- [ ] **Step 1: Allow selecting and uploading multiple files**

Change the file input to `multiple` and send every selected file. Keep the existing per-file HEIC→JPEG conversion, but map over all files:
```tsx
<input
  type="file"
  accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
  multiple
  onChange={handleFilesSelected}
/>
```
```tsx
async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
  const selected = Array.from(e.target.files ?? []);
  if (selected.length === 0) return;
  const prepared: File[] = [];
  for (const raw of selected) {
    prepared.push(await convertHeicIfNeeded(raw)); // existing HEIC logic extracted into a helper
  }
  const formData = new FormData();
  formData.append("lessonId", lessonId);
  formData.append("activityId", activity.activity_id);
  formData.append("pupilId", pupilId);
  for (const f of prepared) formData.append("files", f);
  if (feedbackAssignmentIds.length > 0) {
    formData.append("groupAssignmentId", feedbackAssignmentIds[0]);
  }
  // POST to /api/pupil-submission/upload-worksheet as before
}
```

- [ ] **Step 2: Render the OCR state machine**

Drive UI from the latest submission's `ocr_status`:
- `extracting`: show uploaded thumbnails + "Reading your work…" spinner.
- `extracted` / `marking` / `marked`: show a textarea pre-filled with `extractedText`, plus the thumbnails. Below the textarea, a "Save & re-mark" button that calls `editWorksheetTextAction`.
- `error`: show `ocr_error` + a "Try re-uploading" prompt.

```tsx
{status === "extracting" ? (
  <p className="text-sm text-muted-foreground">Reading your work…</p>
) : status === "error" ? (
  <p className="text-sm text-destructive">{body.ocr_error ?? "Couldn't read the images."}</p>
) : (
  <div className="space-y-2">
    <textarea
      className="w-full rounded-md border p-2 text-sm"
      value={draftText}
      onChange={(e) => setDraftText(e.target.value)}
    />
    <button type="button" onClick={handleSaveAndRemark} disabled={saving}>
      {saving ? "Saving…" : "Save & re-mark"}
    </button>
  </div>
)}
```

- [ ] **Step 3: Subscribe to SSE for live status**

Open an `EventSource` to `/sse?topics=submissions` (mirror `fast-ui-panel.tsx`), and on a `submission.updated` envelope whose `submissionId` matches the current submission, update local `status`/`extractedText`. Close on unmount.

- [ ] **Step 4: Verify in the browser**

Start/confirm the dev server, then use the preview tools: upload two PNGs to an `upload-worksheet` activity as a pupil, confirm both thumbnails render and the status shows "Reading your work…". (Full OCR round-trip is verified in Task 10 with a stubbed callback.)

- [ ] **Step 5: Commit**

```bash
git add src/components/pupil/pupil-upload-worksheet-activity.tsx
git commit -m "feat: pupil worksheet UI supports multi-image upload and editable OCR text"
```

---

## Task 7: Edit text → new attempt + re-mark

**Files:**
- Create or modify: `src/lib/server-actions/submissions.ts` — add `editWorksheetTextAction`

**Interfaces:**
- Consumes: `getNextAttemptNumber` from `src/lib/server-actions/submission-attempts.ts`; `enqueueMarkingTasks` + `triggerQueueProcessor`; `UploadWorksheetSubmissionBodySchema`.
- Produces: `editWorksheetTextAction({ activityId, userId, sourceSubmissionId, text, groupAssignmentId }): Promise<{ success: boolean; error: string | null; data: Submission | null }>`.

- [ ] **Step 1: Implement the action**

A text edit is a new attempt that skips OCR (copies the source attempt's images, uses the edited text, starts at `marking`), then enqueues marking:
```typescript
export async function editWorksheetTextAction(input: {
  activityId: string;
  userId: string;
  sourceSubmissionId: string;
  text: string;
  groupAssignmentId?: string;
}): Promise<{ success: boolean; error: string | null; data: Submission | null }> {
  const { rows } = await query<{ body: unknown }>(
    `select body from submissions where submission_id = $1 limit 1`,
    [input.sourceSubmissionId],
  );
  const source = rows?.[0];
  if (!source) return { success: false, error: "Source attempt not found.", data: null };

  const sourceBody = UploadWorksheetSubmissionBodySchema.parse(source.body ?? {});
  const newBody = UploadWorksheetSubmissionBodySchema.parse({
    images: sourceBody.images,
    extractedText: input.text,
    ocr_status: "marking",
    ocr_error: null,
    is_correct: false,
    success_criteria_scores: {},
  });

  const attemptNumber = await getNextAttemptNumber(input.activityId, input.userId);
  const { rows: inserted } = await query(
    `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status)
     values ($1, $2, $3, $4, now(), 'submitted')
     returning *`,
    [input.activityId, input.userId, attemptNumber, newBody],
  );
  const created = SubmissionSchema.parse(inserted[0]);

  if (input.groupAssignmentId) {
    try {
      await enqueueMarkingTasks(input.groupAssignmentId, [{ submissionId: created.submission_id }]);
      await triggerQueueProcessor();
    } catch (err) {
      console.error("[editWorksheetTextAction] enqueue marking failed", err);
    }
  }
  void emitSubmissionEvent("submission.updated", {
    submissionId: created.submission_id,
    activityId: input.activityId,
    ocrStatus: "marking",
  });
  return { success: true, error: null, data: created };
}
```
Re-export it via `src/lib/server-updates.ts` following the existing consolidation pattern.

- [ ] **Step 2: Type-check and lint**

Run: `pnpm build && pnpm lint`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/submissions.ts src/lib/server-updates.ts
git commit -m "feat: editWorksheetTextAction creates a new attempt and re-marks"
```

---

## Task 8: Teacher results page — images + OCR text + edit/re-mark

**Files:**
- Modify: `src/lib/scoring/activity-scores.ts` (worksheet `pupilAnswer` extraction, ~lines 520-554)
- Modify: `src/components/assignment-results/assignment-results-dashboard.tsx` (attempt modal + file-URL effect)

**Interfaces:**
- Consumes: `editWorksheetTextAction` (Task 7); the existing `getPupilActivitySubmissionUrlAction` for image URLs.

- [ ] **Step 1: Extract OCR text as the pupil answer**

In `activity-scores.ts`, for `upload-worksheet`, set `pupilAnswer` to `parsed.data.extractedText` when present (fallback to a filename summary for legacy rows):
```typescript
const pupilAnswer =
  typeof parsed.data.extractedText === "string" && parsed.data.extractedText.trim()
    ? parsed.data.extractedText
    : parsed.data.fileName?.trim()
      ? `Uploaded: ${parsed.data.fileName.trim()}`
      : parsed.data.images?.length
        ? `${parsed.data.images.length} image(s) uploaded`
        : null;
```

- [ ] **Step 2: Render all images + editable OCR text in the attempt modal**

In the dashboard's attempt modal, replace the single-file URL effect with one that resolves a URL per image in `body.images` (fall back to legacy `body.fileName`). Render thumbnails linking to full images, and show the OCR `extractedText` in an editable textarea when the viewer is a teacher, with a "Save & re-mark" button calling `editWorksheetTextAction({ activityId, userId, sourceSubmissionId: viewingAttempt.submission_id, text, groupAssignmentId })`.

```tsx
{worksheetImages.map((img) => (
  <a key={img.fileName} href={img.url ?? "#"} target="_blank" rel="noopener noreferrer">
    <img src={img.url ?? ""} alt={img.fileName} className="h-24 rounded border object-cover" />
  </a>
))}
{isAdmin ? (
  <>
    <textarea value={ocrDraft} onChange={(e) => setOcrDraft(e.target.value)} className="w-full rounded border p-2 text-sm" />
    <button type="button" onClick={handleTeacherSaveAndRemark}>Save & re-mark</button>
  </>
) : (
  <p className="whitespace-pre-wrap text-sm">{extracted.pupilAnswer}</p>
)}
```

- [ ] **Step 3: Type-check, lint, and verify in browser**

Run: `pnpm build && pnpm lint`
Then use the preview tools to open an assignment-results view for a worksheet activity with a marked attempt and confirm images + OCR text render and the teacher edit box appears.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scoring/activity-scores.ts src/components/assignment-results/assignment-results-dashboard.tsx
git commit -m "feat: teacher results show worksheet images + editable OCR text with re-mark"
```

---

## Task 9: SSE status events wiring (audit + gaps)

**Files:**
- Modify: `src/app/api/pupil-submission/upload-worksheet/route.ts` (emit `submission.updated` with `ocrStatus: "extracting"` after insert)
- Verify: `src/app/webhooks/image-to-text/route.ts` (emits `marking`), `src/app/webhooks/ai-mark/route.ts` (marked)

**Interfaces:**
- Produces: `submission.updated` events on topic `submissions` carrying `{ submissionId, activityId, ocrStatus }` at each transition, consumed by the pupil component (Task 6) and — if it subscribes — the teacher dashboard.

- [ ] **Step 1: Emit on upload**

After the submission insert in the upload route, add:
```typescript
void emitSubmissionEvent("submission.updated", {
  submissionId,
  activityId,
  ocrStatus: "extracting",
});
```

- [ ] **Step 2: Confirm the marked transition emits**

The existing `ai-mark` webhook already emits `assignment.results.updated` on topic `assignments`. Confirm the pupil component subscribes to whichever topic carries the final state; if the pupil view only listens on `submissions`, also emit a `submission.updated` with `ocrStatus: "marked"` from `applyAiMarkToSubmission` for `upload-worksheet`. Do not duplicate scoring logic — only add the SSE emit.

- [ ] **Step 3: Type-check, lint**

Run: `pnpm build && pnpm lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pupil-submission/upload-worksheet/route.ts src/app/webhooks/ai-mark/route.ts
git commit -m "feat: emit submission SSE events across OCR/marking state transitions"
```

---

## Task 10: E2E test + n8n contract doc

**Files:**
- Create: `tests/worksheets/exam-question-ocr.spec.ts`
- Create: `docs/n8n/image-to-pupil-submission-workflow.md`

- [ ] **Step 1: Document the OCR workflow HTTP contract**

Create `docs/n8n/image-to-pupil-submission-workflow.md` describing:
- **Inbound** (dino → n8n `N8N_OCR_WEBHOOK_URL`): JSON `{ submission_id, activity_id, pupil_id, webhook_url, group_assignment_id?, images: [{ url, fileName }] }`, header `x-ocr-key: <N8N_OCR_AUTH>`.
- **Transcription rule**: transcribe faithfully — preserve the pupil's exact spelling, punctuation, and grammar; do NOT autocorrect (SPAG is being marked). Concatenate multiple pages in upload order with a blank line between pages.
- **Outbound** (n8n → dino `webhook_url`): JSON `{ submission_id, text, group_assignment_id? }`, header `image-ocr-service-key: <IMAGE_OCR_SERVICE_KEY>`.
- Note that the marking workflow now receives `extracted_text` (not `WORKSHEET_IMAGE`) for worksheet activities and must be updated to mark text.

- [ ] **Step 2: Write the E2E spec**

Create `tests/worksheets/exam-question-ocr.spec.ts` covering: pupil uploads two images to a worksheet activity → the activity shows the extracting state → simulate the OCR callback with `curl`/`request.post` to `/webhooks/image-to-text` (with the service key) → the editable text appears → simulate the marking callback to `/webhooks/ai-mark` → the score/feedback appears. Use the existing test auth/session setup (`storageState.json`) and follow patterns in the current `tests/` specs.

- [ ] **Step 3: Run the E2E test**

Run: `pnpm test -- exam-question-ocr`
Expected: the spec passes. If auth/session setup differs, align with existing specs before asserting completion.

- [ ] **Step 4: Commit**

```bash
git add tests/worksheets/exam-question-ocr.spec.ts docs/n8n/image-to-pupil-submission-workflow.md
git commit -m "test: e2e for worksheet OCR->edit->mark flow + n8n contract doc"
```

---

## Final Verification (before merge)

- [ ] `pnpm build` — clean.
- [ ] `pnpm lint` — clean.
- [ ] `pnpm test` — worksheet spec passes.
- [ ] `git status` inside the worktree — every new file (`ocr-client.ts`, `image-to-text/route.ts`, spec, docs) is committed (untracked files are invisible to a merge).
- [ ] Manual smoke: upload 2 images as a pupil, POST a fake OCR callback, confirm editable text + auto-mark, edit as teacher, confirm a new attempt with a fresh score.
- [ ] Migrations: none required (state lives in `submissions.body`); confirm no `src/migrations/` file was added.
- [ ] Then use the `merge-tree` skill to merge `feature/exam-question-ocr` into main.
