import { NextResponse } from "next/server";

import { logQueueEvent } from "@/lib/ai/marking-queue";
import { enqueueJob, triggerJobProcessor } from "@/lib/jobs/external-jobs";

export const dynamic = "force-dynamic";

/**
 * Inbound revision-marking webhook. Authenticates and captures the payload onto
 * the external-jobs queue; a `webhook_apply` job (source: ai-mark-revision)
 * applies the marks. Keeps every callback tracked and retryable.
 */
export async function POST(request: Request) {
  const expectedServiceKey = process.env.MARK_SERVICE_KEY ?? process.env.AI_MARK_SERVICE_KEY;
  const inboundServiceKey =
    request.headers.get("mark-service-key") ?? request.headers.get("Mark-Service-Key");

  if (!expectedServiceKey || inboundServiceKey?.trim() !== expectedServiceKey.trim()) {
    console.warn("[ai-mark-revision] Unauthorized webhook attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const jobId = await enqueueJob("webhook_apply", { source: "ai-mark-revision", payload: json });
    void triggerJobProcessor();
    await logQueueEvent("info", "Revision webhook payload queued for processing", { jobId });
    return NextResponse.json({ success: true, queued: true, jobId });
  } catch (error) {
    console.error("[ai-mark-revision] Failed to enqueue payload", error);
    return NextResponse.json({ error: "Unable to queue payload." }, { status: 500 });
  }
}
