import "server-only";

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

export interface ApplyOcrTextResult {
  ok: boolean;
  reason?: string;
}

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
    const matches = [...trimmed.matchAll(/"submission_text"\s*:\s*"([\s\S]*?)"\s*}/g)];
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

/**
 * Apply an inbound OCR transcript: store the extracted text on the worksheet
 * submission and forward it to the marking queue. Permanent conditions
 * (invalid payload, missing/invalid submission) return `ok:false` without
 * throwing so the job is not retried.
 */
export async function applyOcrTextPayload(json: unknown): Promise<ApplyOcrTextResult> {
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid_payload" };
  const { submission_id, text, group_assignment_id } = parsed.data;

  const { rows } = await query<{ body: unknown; activity_id: string; user_id: string }>(
    `select body, activity_id, user_id from submissions where submission_id = $1 limit 1`,
    [submission_id],
  );
  const row = rows?.[0];
  if (!row) return { ok: false, reason: "submission_not_found" };

  const currentBody = UploadWorksheetSubmissionBodySchema.safeParse(row.body ?? {});
  if (!currentBody.success) {
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
    return { ok: false, reason: "invalid_submission_body" };
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

  // Forward the transcript to the marking queue.
  if (group_assignment_id) {
    await enqueueMarkingTasks(group_assignment_id, [{ submissionId: submission_id }]);
    void triggerQueueProcessor();
  } else {
    console.warn("[apply-ocr-text] No group_assignment_id — text stored but marking not enqueued", {
      submission_id,
    });
  }

  return { ok: true };
}
