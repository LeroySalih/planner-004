import "server-only";

import { z } from "zod";

import { query } from "@/lib/db";
import { logQueueEvent, resolveQueueItem } from "@/lib/ai/marking-queue";

const ValidationSchema = z.object({
  group_assignment_id: z.literal("revision"),
  activity_id: z.string().uuid(),
  results: z.array(
    z.object({
      pupilid: z.string().optional(),
      pupilId: z.string().optional(),
      pupil_id: z.string().optional(),
      score: z.number(),
      feedback: z.string().optional().nullable(),
    }),
  ),
});

export interface ApplyRevisionMarkResult {
  ok: boolean;
  reason?: string;
  updated?: number;
}

/**
 * Apply an inbound revision-marking webhook payload: match each result to the
 * pupil's pending revision answer and record the score + feedback. Permanent
 * conditions return `ok:false` without throwing; per-answer DB errors are
 * logged and skipped (mirroring the original inline behaviour).
 */
export async function applyRevisionMarkPayload(json: unknown): Promise<ApplyRevisionMarkResult> {
  const parsed = ValidationSchema.safeParse(json);
  if (!parsed.success) {
    await logQueueEvent("error", "Revision webhook validation failed", { error: parsed.error });
    return { ok: false, reason: "invalid_payload" };
  }

  const { activity_id, results } = parsed.data;
  let updatedCount = 0;

  for (const result of results) {
    const pupilId = result.pupilid ?? result.pupilId ?? result.pupil_id;
    if (!pupilId) continue;

    try {
      const { rows: answerRows } = await query<{ answer_id: string; answer_data: unknown }>(
        `SELECT ra.answer_id, ra.answer_data
           FROM revision_answers ra
           JOIN revisions r ON r.revision_id = ra.revision_id
          WHERE ra.activity_id = $1
            AND r.pupil_id = $2
            AND ra.status IN ('marking', 'pending_marking')
          ORDER BY ra.created_at DESC
          LIMIT 1`,
        [activity_id, pupilId],
      );

      const targetAnswer = answerRows[0];
      if (targetAnswer) {
        const aiScore = Math.min(1, Math.max(0, result.score));
        const feedback = result.feedback || "";

        await query(
          `UPDATE revision_answers SET status = 'marked', score = $1, feedback = $2 WHERE answer_id = $3`,
          [aiScore, feedback, targetAnswer.answer_id],
        );

        await resolveQueueItem(targetAnswer.answer_id);
        await logQueueEvent("info", "Revision answer marked via webhook", {
          answerId: targetAnswer.answer_id,
          score: aiScore,
        });
        updatedCount++;
      } else {
        await logQueueEvent(
          "warn",
          `No pending revision answer found for pupil ${pupilId} activity ${activity_id}`,
        );
      }
    } catch (dbError) {
      console.error("[apply-revision-mark] DB error handling revision result", dbError);
      await logQueueEvent("error", "DB error for revision webhook", { error: String(dbError) });
    }
  }

  return { ok: true, updated: updatedCount };
}
