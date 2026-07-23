import { NextResponse } from "next/server";

import { logQueueEvent } from "@/lib/ai/marking-queue";
import { enqueueJob, triggerJobProcessor } from "@/lib/jobs/external-jobs";

export const dynamic = "force-dynamic";

/**
 * Inbound AI-mark webhook. The endpoint only authenticates and captures the
 * payload onto the external-jobs queue, then returns immediately. A
 * `webhook_apply` job validates and applies the marks (via applyAiMarkPayload),
 * so every callback is tracked, retryable and decoupled from the HTTP request.
 */
export async function POST(request: Request) {
  const headerMap: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headerMap[key] =
      key.toLowerCase().includes("key") || key.toLowerCase().includes("auth")
        ? "[REDACTED]"
        : value;
  });

  const expectedServiceKey = process.env.MARK_SERVICE_KEY ?? process.env.AI_MARK_SERVICE_KEY;
  if (!expectedServiceKey || expectedServiceKey.trim().length === 0) {
    console.error("[ai-mark-webhook] MARK_SERVICE_KEY is not configured");
    await logQueueEvent("error", "Webhook failed: MARK_SERVICE_KEY not configured on server", {
      headers: headerMap,
    });
    return NextResponse.json(
      { success: false, error: "AI mark webhook is not configured.", details: { missingEnv: "MARK_SERVICE_KEY" } },
      { status: 500 },
    );
  }

  const inboundServiceKey =
    request.headers.get("mark-service-key") ?? request.headers.get("Mark-Service-Key");
  if (!inboundServiceKey || inboundServiceKey.trim() !== expectedServiceKey.trim()) {
    console.warn("[ai-mark-webhook] Unauthorized webhook attempt: missing or mismatched mark-service-key header.");
    await logQueueEvent("warn", "Unauthorized webhook attempt", {
      receivedHeader: inboundServiceKey ? "Present (mismatched)" : "Missing",
      headers: headerMap,
    });
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        details: {
          header: "mark-service-key",
          message: !inboundServiceKey ? "Header missing" : "Header present but does not match MARK_SERVICE_KEY.",
        },
      },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch (error) {
    console.error("[ai-mark-webhook] Failed to parse payload", error);
    return NextResponse.json({ success: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  // Capture the response onto the tracked queue; the worker applies it.
  let jobId: string;
  try {
    jobId = await enqueueJob("webhook_apply", { source: "ai-mark", payload: json });
    void triggerJobProcessor();
    await logQueueEvent("info", "Webhook payload queued for processing", {
      jobId,
      resultCount: (json as { results?: unknown[] })?.results?.length,
    });
  } catch (error) {
    console.error("[ai-mark-webhook] Failed to enqueue webhook payload", error);
    return NextResponse.json({ success: false, error: "Unable to queue payload." }, { status: 500 });
  }

  return NextResponse.json({ success: true, queued: true, jobId });
}
