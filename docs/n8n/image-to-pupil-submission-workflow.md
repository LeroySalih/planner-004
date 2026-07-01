# n8n Workflow: Image → Pupil Submission (OCR)

Converts pupil worksheet images to extracted text and forwards to the AI marking pipeline.

---

## Overview

```
dino ──POST──▶ n8n (OCR)
                 │
                 └──POST──▶ dino /webhooks/image-to-text
                                    │
                                    └──▶ marking queue ──▶ /webhooks/ai-mark
```

Images are sent as base64 strings (not URLs) because uploaded files are stored locally and are not publicly accessible.

---

## 1. Inbound: dino → n8n

**Trigger:** pupil uploads one or more worksheet images.

**Env var:** `N8N_OCR_WEBHOOK_URL`

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
x-ocr-key: <N8N_OCR_AUTH>
```

**Body:**
```json
{
  "submission_id": "uuid",
  "activity_id": "uuid",
  "pupil_id": "uuid",
  "webhook_url": "<AI_MARKING_CALLBACK_URL>/webhooks/image-to-text",
  "group_assignment_id": "string (optional)",
  "images": [
    { "base64": "<base64-encoded image data>", "fileName": "page1.jpg" },
    { "base64": "<base64-encoded image data>", "fileName": "page2.jpg" }
  ]
}
```

`images` is ordered by upload sequence. Each element carries the raw base64 content of the file (no `data:...;base64,` prefix).

---

## 2. Transcription Rule

n8n must transcribe the handwritten content **faithfully**:

- Preserve the pupil's exact spelling, punctuation, and grammar.
- **Do NOT autocorrect.** SPAG (Spelling, Punctuation and Grammar) is part of what is being marked.
- If multiple images are present, concatenate their transcriptions in upload order, separated by a single blank line between pages.

---

## 3. Outbound: n8n → dino

n8n posts the extracted text back to the URL supplied in `webhook_url`.

**Endpoint:** `<AI_MARKING_CALLBACK_URL>/webhooks/image-to-text`

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
image-ocr-service-key: <IMAGE_OCR_SERVICE_KEY>
```

**Body:**
```json
{
  "submission_id": "uuid",
  "text": "Pupil's handwritten text, faithfully transcribed.",
  "group_assignment_id": "string (optional — include if it was present in the inbound payload)"
}
```

**Responses:**

| Status | Meaning |
|--------|---------|
| `200 { "success": true }` | Text stored, marking enqueued. |
| `400` | Missing or invalid JSON payload. |
| `401` | `image-ocr-service-key` header missing or incorrect. |
| `404` | `submission_id` not found in the database. |
| `500` | Server misconfiguration (e.g. `IMAGE_OCR_SERVICE_KEY` env var not set). |

---

## 4. Downstream Effect in dino

On receiving a valid callback, dino:

1. Stores the transcript in `submissions.body.extractedText`.
2. Sets `submissions.body.ocr_status` → `"marking"` (clears `ocr_error`).
3. Broadcasts a `submission.updated` SSE event so the pupil UI refreshes.
4. If `group_assignment_id` is present, enqueues the existing AI marking task and triggers the queue processor.
   - The marking payload now includes `extracted_text` for `upload-worksheet` activities, not a `WORKSHEET_IMAGE` reference.
   - Marking result returns via `/webhooks/ai-mark` (header `mark-service-key`) as before.

---

## 5. OCR Status State Machine

```
(upload)
   │
   ▼
extracting  ──── OCR callback ────▶  marking  ──── mark callback ────▶  marked
   │                                    │
   └──── OCR error ────────────────────▶  error
```

| State | Trigger |
|-------|---------|
| `extracting` | Images uploaded; OCR dispatched to n8n. |
| `marking` | `/webhooks/image-to-text` received valid text. |
| `marked` | `/webhooks/ai-mark` received valid score/feedback. |
| `error` | OCR or marking step failed (details in `ocr_error`). |

**Re-uploads / edits:** if a pupil edits the transcript or re-uploads images, a new submission attempt is created with a fresh state beginning at `extracting`.

---

## 6. Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `N8N_OCR_WEBHOOK_URL` | dino (outbound) | n8n webhook trigger URL |
| `N8N_OCR_AUTH` | dino (outbound) | Auth token sent as `x-ocr-key` |
| `AI_MARKING_CALLBACK_URL` | dino (outbound) | Base URL of dino; forms `webhook_url` in the inbound payload |
| `IMAGE_OCR_SERVICE_KEY` | dino (inbound) | Expected value of `image-ocr-service-key` header from n8n |
| `MARK_SERVICE_KEY` | dino (inbound) | Expected value of `mark-service-key` header from AI marking service |
