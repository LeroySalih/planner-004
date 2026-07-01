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
