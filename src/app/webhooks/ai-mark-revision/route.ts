import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { logQueueEvent, resolveQueueItem } from "@/lib/ai/marking-queue";
import { revalidatePath } from "next/cache";
import { ShortTextActivityBodySchema } from "@/types";

export const dynamic = "force-dynamic";

// Schema for the payload sent by the DO function (simplified for Revisions)
// We largely expect the same structure, but we only really care about the 'results' in a simpler way
const ValidationSchema = z.object({
    group_assignment_id: z.literal("revision"), // We strictly expect 'revision' here now
    activity_id: z.string().uuid(),
    results: z.array(z.object({
        pupilid: z.string().optional(),
        pupilId: z.string().optional(),
        pupil_id: z.string().optional(),
        score: z.number(),
        feedback: z.string().optional().nullable(),
    })),
});

export async function POST(request: Request) {
    // 1. Auth Check (Reuse existing key)
    const expectedServiceKey = process.env.MARK_SERVICE_KEY ??
        process.env.AI_MARK_SERVICE_KEY;
    const inboundServiceKey = request.headers.get("mark-service-key") ??
        request.headers.get("Mark-Service-Key");

    if (
        !expectedServiceKey ||
        inboundServiceKey?.trim() !== expectedServiceKey.trim()
    ) {
        console.warn("[ai-mark-revision] Unauthorized webhook attempt");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse Payload
    let json: any;
    try {
        json = await request.json();
    } catch (e) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = ValidationSchema.safeParse(json);
    if (!parsed.success) {
        console.error("[ai-mark-revision] Validation failed", parsed.error);
        await logQueueEvent("error", "Revision webhook validation failed", {
            error: parsed.error,
        });
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { activity_id, results } = parsed.data;

    let updatedCount = 0;

    // 3. Process Results
    for (const result of results) {
        // In revisions, we treat the 'pupil_id' in the result as the user_id.
        // However, we queued the answer_id as the submission_id in the queue.
        // But the DO function returns results keyed by pupil_id (because we sent pupil_id).
        // Wait, regular submissions are keyed by pupil_id.
        // For revision answers, we need to find the answer record.
        // We know: activity_id + pupil_id + revision "in_progress" (or just by activity/pupil recent?)

        // BETTER APPROACH:
        // In `marking-queue.ts`, when we invoke the DO function, we send `pupil_id`.
        // The DO function returns that `pupil_id` in the result.
        // We need to match that back to the `revision_answers`.

        const pupilId = result.pupilid ?? result.pupilId ?? result.pupil_id;
        if (!pupilId) continue;

        // Find the specific answer.
        // Logic: Find the most recent 'pending_marking' answer for this pupil + activity.
        // OR, find the answer associated with the submission_id we queued?
        // The payload doesn't necessarily return submission_id unless we passed it in dataSent (which we do, but DO might not echo it back in 'results').
        // The DO function output `{"resultCount": 1}` implies it processed inputs.
        // Standard "do-ai-marking" (agentic-style) usually returns results mapped to inputs.

        // Let's assume we can look up by (activity_id, pupil_id) AND status='pending_marking' (or in_progress revision).

        try {
            // Fetch the specific answer(s) that are pending marking
            const { rows: answerRows } = await query<
                { answer_id: string; answer_data: any }
            >(
                `SELECT ra.answer_id, ra.answer_data
                  FROM revision_answers ra
                  JOIN revisions r ON r.revision_id = ra.revision_id
                  WHERE ra.activity_id = $1 
                    AND r.pupil_id = $2
                    AND ra.status = 'pending_marking'
                  ORDER BY ra.created_at DESC
                  LIMIT 1`,
                [activity_id, pupilId],
            );

            const targetAnswer = answerRows[0];

            if (targetAnswer) {
                // Update the Answer
                const aiScore = Math.min(1, Math.max(0, result.score)); // Clamp 0-1
                const feedback = result.feedback || "";

                // Update answer status
                await query(
                    `UPDATE revision_answers 
                      SET status = 'marked',
                          score = $1,
                          feedback = $2
                      WHERE answer_id = $3`,
                    [aiScore, feedback, targetAnswer.answer_id],
                );

                // Also update the JSON body with metadata if needed?
                // The `revision_answers` table has `answer_data` (jsonb).
                // Typically `answer_data` holds `{ answer_chosen: ... }` or `{ answer: ... }`.
                // We can append `ai_feedback` to it if we want persistent storage inside the JSON too,
                // but `feedback` column exists. Let's stick to columns for now as it's cleaner.

                // Resolve Queue Item
                // We queued `answer_id` as `submission_id`.
                await resolveQueueItem(targetAnswer.answer_id);
                await logQueueEvent(
                    "info",
                    `Revision answer marked via webhook`,
                    { answerId: targetAnswer.answer_id, score: aiScore },
                );

                updatedCount++;

                // Revalidate unique page
                // We'd need the revision_id to be precise, but we can't easily get it without another query or join above.
                // It's okay, user will refresh or we rely on client-side polling/server actions.
            } else {
                await logQueueEvent(
                    "warn",
                    `No pending revision answer found for pupil ${pupilId} activity ${activity_id}`,
                );
            }
        } catch (dbError) {
            console.error("DB Error handling revision result", dbError);
            await logQueueEvent("error", `DB Error for revision webhook`, {
                error: String(dbError),
            });
        }
    }

    return NextResponse.json({ success: true, updated: updatedCount });
}
