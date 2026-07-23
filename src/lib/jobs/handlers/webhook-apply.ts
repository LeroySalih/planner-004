import "server-only";

import { applyAiMarkPayload } from "@/lib/ai/apply-ai-mark";
import { applyRevisionMarkPayload } from "@/lib/ai/apply-revision-mark";
import { applyOcrTextPayload } from "@/lib/ai/apply-ocr-text";
import type { ExternalJob } from "../external-jobs";

type WebhookSource = "ai-mark" | "ai-mark-revision" | "image-to-text";

interface WebhookApplyPayload {
  source: WebhookSource;
  payload: unknown;
}

/**
 * Process an inbound webhook response that was captured onto the queue. The
 * webhook endpoint authenticates and enqueues the raw payload; this handler
 * does the actual work (validate + apply), so every callback is tracked and
 * retryable.
 */
export async function handleWebhookApply(job: ExternalJob): Promise<unknown> {
  const data = job.payload as unknown as WebhookApplyPayload;
  switch (data.source) {
    case "ai-mark":
      return applyAiMarkPayload(data.payload);
    case "ai-mark-revision":
      return applyRevisionMarkPayload(data.payload);
    case "image-to-text":
      return applyOcrTextPayload(data.payload);
    default:
      throw new Error(`Unknown webhook source: ${(data as WebhookApplyPayload).source}`);
  }
}
