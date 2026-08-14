# Replace n8n with direct Gemini calls

> **STATUS: done (merged 2026-08-14).** n8n is removed from marking and OCR.
> Migration `084` drains the queue at cutover. The living description of the
> pipeline is the "AI Marking Pipeline" section of CLAUDE.md — prefer that; this
> document records why the change was made.

**Goal:** remove n8n from the marking and OCR paths. DINO calls Gemini directly
from the queue worker and applies the result in the same pass.

## Why

After per-criterion marking landed, DINO already owns queueing, retry, fan-out,
the gather and all scoring arithmetic. n8n contributed one model call and the
prompt text. Keeping it cost: a blocked feature (the flow was never updated to
echo `success_criteria_id`), invisible failures for up to 10 minutes when a call
died inside n8n, two network hops and two queue jobs per criterion, and prompts
that could not be reviewed, tested or deployed atomically with the code.

The project already calls Gemini directly in `unit-chat-gemini.ts` /
`lesson-chat-gemini.ts`, including `responseSchema` structured output and a
retry loop on 429/503. That is the template.

## Design

**The application layer does not change.** `applyAiMarkPayload`,
`applyRevisionMarkPayload` and `applyOcrTextPayload` keep their exact payload
contracts — they are tested and they already understand per-criterion results.
Only the transport changes: instead of the payload arriving over HTTP from n8n,
the queue worker builds it and calls the function directly.

```
BEFORE  job → n8n → (model) → HTTP callback → webhook_apply job → apply*()
AFTER   job → (model) → apply*()
```

One job per criterion instead of two, and a failed model call now throws into
the existing `attempts` / `process_after` backoff instead of vanishing.

**Structured output.** Marking uses a `responseSchema` constraining
`marks_awarded` to an integer and `feedback` to a string, so the reply cannot
arrive malformed. The prompt states explicitly that 0 is valid — the thing that
could only be *requested* of n8n.

## Files

New:
- `src/lib/ai/gemini-client.ts` — shared call + retry, extracted from the chat modules
- `src/lib/ai/gemini-marking.ts` — text and vision marking, per criterion
- `src/lib/ai/gemini-ocr.ts` — worksheet transcription

Changed:
- `src/lib/ai/marking-queue.ts` — call and apply inline
- `src/app/api/pupil-submission/upload-worksheet/route.ts` — OCR inline

Deleted:
- `src/lib/ai/ai-marking-client.ts`, `worksheet-marking-client.ts`, `ocr-client.ts`
- `src/app/webhooks/ai-mark/`, `ai-mark-revision/`, `image-to-text/`
- `src/lib/jobs/handlers/webhook-apply.ts` and the `webhook_apply` job type
- env: `N8N_*`, `MARK_SERVICE_KEY`, `AI_MARKING_CALLBACK_URL`

## Order

1. Gemini client + marking module (text), STQ only, prove it end to end
2. Spreadsheet and upload-worksheet text marking
3. mark-worksheet vision marking
4. OCR
5. Delete n8n clients, webhook routes, env vars
