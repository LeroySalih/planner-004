import { NextResponse } from "next/server";

import { enqueueJob, triggerJobProcessor } from "@/lib/jobs/external-jobs";

export const dynamic = "force-dynamic";

/**
 * Inbound OCR (image-to-text) webhook. Authenticates and captures the payload
 * onto the external-jobs queue; a `webhook_apply` job (source: image-to-text)
 * stores the transcript on the submission and forwards it to marking. Keeps
 * every callback tracked and retryable.
 */
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

  try {
    const jobId = await enqueueJob("webhook_apply", { source: "image-to-text", payload: json });
    void triggerJobProcessor();
    return NextResponse.json({ success: true, queued: true, jobId });
  } catch (error) {
    console.error(`${tag} Failed to enqueue payload`, error);
    return NextResponse.json({ error: "Unable to queue payload." }, { status: 500 });
  }
}
