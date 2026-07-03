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

/**
 * The OCR agent returns its transcript as a JSON array of
 * `{ question_number?, submission_text }` objects. Normalise that into a single
 * plain-text string (real newlines, no JSON wrapper) for storage/marking. If the
 * text isn't that shape, it is returned unchanged.
 */
function normaliseOcrText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return raw;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Malformed JSON — the model commonly emits literal newlines inside the
    // string, which is not valid JSON. Extract the submission_text value(s) by
    // regex so we still store clean text rather than the raw JSON wrapper.
    const matches = [
      ...trimmed.matchAll(/"submission_text"\s*:\s*"([\s\S]*?)"\s*}/g),
    ];
    const parts = matches
      .map((match) => match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim())
      .filter((part) => part !== "");
    return parts.length > 0 ? parts.join("\n\n") : raw;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const parts = entries
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const value = (entry as { submission_text?: unknown }).submission_text;
        const questionNumber = (entry as { question_number?: unknown }).question_number;
        if (typeof value === "string") {
          const prefix =
            questionNumber != null && String(questionNumber).trim() !== ""
              ? `${String(questionNumber).trim()}. `
              : "";
          return `${prefix}${value}`;
        }
      }
      return typeof entry === "string" ? entry : "";
    })
    .filter((part) => part.trim() !== "");
  return parts.length > 0 ? parts.join("\n\n") : raw;
}

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

  const { rows } = await query<{ body: unknown; activity_id: string; user_id: string }>(
    `select body, activity_id, user_id from submissions where submission_id = $1 limit 1`,
    [submission_id],
  );
  const row = rows?.[0];
  if (!row) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const currentBody = UploadWorksheetSubmissionBodySchema.safeParse(row.body ?? {});
  if (!currentBody.success) {
    // Not a worksheet submission or invalid body — mark as reading-error
    await query(
      `update submissions set mark_status = 'reading-error', mark_error = $1 where submission_id = $2`,
      ["Invalid submission body.", submission_id],
    );
    void emitSubmissionEvent("submission.updated", {
      submissionId: submission_id,
      activityId: row.activity_id,
      pupilId: row.user_id,
      markStatus: "reading-error",
      markError: "Invalid submission body.",
    });
    return NextResponse.json({ error: "Invalid submission body." }, { status: 400 });
  }

  const nextBody = UploadWorksheetSubmissionBodySchema.parse({
    ...currentBody.data,
    extractedText: normaliseOcrText(text),
  });
  await query(
    `update submissions set body = $1, mark_status = 'waiting', mark_error = null where submission_id = $2`,
    [nextBody, submission_id],
  );

  void emitSubmissionEvent("submission.updated", {
    submissionId: submission_id,
    activityId: row.activity_id,
    pupilId: row.user_id,
    markStatus: "waiting",
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
