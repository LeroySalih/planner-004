import "server-only";

import { applyAiMarkPayload } from "@/lib/ai/apply-ai-mark";
import type { ExternalJob } from "../external-jobs";

interface WebhookApplyPayload {
  source: "ai-mark";
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
    case "ai-mark": {
      const result = await applyAiMarkPayload(data.payload);
      return result;
    }
    default:
      throw new Error(`Unknown webhook source: ${(data as WebhookApplyPayload).source}`);
  }
}
