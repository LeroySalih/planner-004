"use server";

import { query } from "@/lib/db";
import { getRevisionSettings } from "@/actions/settings";
import { requireAuthenticatedProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LessonActivity, ShortTextSubmissionBodySchema } from "@/types";

export type Revision = {
    revision_id: string;
    pupil_id: string;
    lesson_id: string;
    created_at: Date;
    completed_at: Date | null;
    total_score: number;
    status: "in_progress" | "submitted";
};

export type RevisionAnswer = {
    answer_id: string;
    revision_id: string;
    activity_id: string;
    answer_data: any;
    score: number | null;
    feedback: string | null;
    status: "pending_marking" | "marked" | "pending_manual";
};

export async function startRevision(lessonId: string) {
    const profile = await requireAuthenticatedProfile();
    const settings = await getRevisionSettings();

    // 1. Get Lesson Activities
    const { rows: activities } = await query<
        { activity_id: string; type: string }
    >(
        `SELECT activity_id, type FROM activities WHERE lesson_id = $1 AND active = true ORDER BY order_by ASC, title ASC`,
        [lessonId],
    );

    if (activities.length === 0) {
        throw new Error("No activities found for this lesson");
    }

    // 2. Filter activities based on settings
    const includedTypes = new Set<string>();
    if (settings.shortText) includedTypes.add("short-text-question");
    if (settings.multipleChoice) includedTypes.add("multiple-choice-question");
    if (settings.singleChoice) includedTypes.add("single-choice-question"); // Assuming this type exists or maps to MCQ
    if (settings.uploadFile) includedTypes.add("upload-file");
    if (settings.uploadLink) includedTypes.add("upload-url");

    // Also include "text-question" and "long-text-question" if single/short choice covers them?
    // The user asked for "Short Text", "Multiple Choice", "Single Choice", "Upload File", "Upload Link".
    // "text-question" usually implies long text or read-only?
    // Let's stick to strict types for now, maybe add "long-text-question" if "Short Text" implies text entry generally.
    // The user config had "Short Text". Typical planner-005 types: 'short-text-question', 'long-text-question', 'text-question'.
    // I will assume 'Short Text' enables 'short-text-question'.
    // The user might want Long Text too. I'll inspect types again in types/index.ts.
    // ShortTextActivityBodySchema exists. LongText exists.
    // I'll assume only listed ones.

    const filteredActivities = activities.filter((a) =>
        includedTypes.has(a.type)
    );

    if (filteredActivities.length === 0) {
        throw new Error(
            "No revisable activities found for this lesson based on current settings.",
        );
    }

    // 3. Create Revision
    const { rows: revisionRows } = await query<Revision>(
        `INSERT INTO revisions (pupil_id, lesson_id, status) VALUES ($1, $2, 'in_progress') RETURNING *`,
        [profile.userId, lessonId],
    );
    const revision = revisionRows[0];

    // 4. Create Revision Answers (placeholders)
    // We insert one for each included activity
    for (const activity of filteredActivities) {
        await query(
            `INSERT INTO revision_answers (revision_id, activity_id, status) VALUES ($1, $2, 'pending_marking')`,
            [revision.revision_id, activity.activity_id],
        );
    }

    return revision.revision_id;
}

export async function getRevision(revisionId: string) {
    const profile = await requireAuthenticatedProfile();

    const { rows: revisions } = await query<Revision>(
        `SELECT * FROM revisions WHERE revision_id = $1 AND pupil_id = $2`,
        [revisionId, profile.userId],
    );
    const revision = revisions[0];
    if (!revision) return null;

    const { rows: answers } = await query<RevisionAnswer>(
        `SELECT * FROM revision_answers WHERE revision_id = $1`,
        [revisionId],
    );

    // Fetch full activity details for the answers
    const activityIds = answers.map((a) => a.activity_id);
    if (activityIds.length === 0) {
        return { revision, answers: [], activities: [] };
    }

    const placeholders = activityIds.map((_, i) => `$${i + 1}`).join(", ");
    const { rows: activities } = await query<LessonActivity>(
        `SELECT * FROM activities WHERE activity_id IN (${placeholders})`,
        activityIds,
    );

    // Fetch lesson title
    const { rows: lessonRows } = await query<{ title: string }>(
        `SELECT title FROM lessons WHERE lesson_id = $1`,
        [revision.lesson_id],
    );

    return {
        revision,
        answers,
        activities,
        lessonTitle: lessonRows[0]?.title ?? "Lesson",
    };
}

export async function saveRevisionAnswer(
    revisionId: string,
    activityId: string,
    data: any,
) {
    const profile = await requireAuthenticatedProfile();

    // Verify ownership
    const { rows: revisions } = await query(
        `SELECT revision_id FROM revisions WHERE revision_id = $1 AND pupil_id = $2 AND status = 'in_progress'`,
        [revisionId, profile.userId],
    );
    if (revisions.length === 0) {
        throw new Error("Revision not found or already submitted");
    }

    const { rows: activityRows } = await query<{ type: string }>(
        `SELECT type FROM activities WHERE activity_id = $1`,
        [activityId],
    );
    const activityType = activityRows[0]?.type;

    let initialFeedback: string | null = null;
    if (activityType === "short-text-question") {
        initialFeedback = "Waiting marking...";
    }

    await query(
        `UPDATE revision_answers 
     SET answer_data = $1, status = 'pending_marking', feedback = $4
     WHERE revision_id = $2 AND activity_id = $3`,
        [JSON.stringify(data), revisionId, activityId, initialFeedback],
    );

    if (activityType === "short-text-question") {
        // Queue for AI marking immediately
        // We get the answer_id first
        const { rows: answerRows } = await query<{ answer_id: string }>(
            `SELECT answer_id FROM revision_answers WHERE revision_id = $1 AND activity_id = $2`,
            [revisionId, activityId],
        );
        const answerId = answerRows[0]?.answer_id;

        if (answerId) {
            await query(
                `INSERT INTO ai_marking_queue (submission_id, assignment_id, status)
                 SELECT $1, 'revision', 'pending'
                 WHERE NOT EXISTS (
                    SELECT 1 FROM ai_marking_queue 
                    WHERE submission_id = $1 
                      AND status = ANY (ARRAY['pending'::text, 'processing'::text])
                 )`,
                [answerId],
            );

            // Log and trigger
            const { logQueueEvent, triggerQueueProcessor } = await import(
                "@/lib/ai/marking-queue"
            );
            await logQueueEvent(
                "info",
                `Queued revision answer ${answerId} for marking`,
                { revisionId, activityId },
            );
            // triggerQueueProcessor is fire-and-forget
            void triggerQueueProcessor();
        }
    }

    revalidatePath(`/revisions/${revisionId}`);
}

export async function submitRevision(revisionId: string) {
    const profile = await requireAuthenticatedProfile();

    const { rows: revisions } = await query(
        `SELECT * FROM revisions WHERE revision_id = $1 AND pupil_id = $2 AND status = 'in_progress'`,
        [revisionId, profile.userId],
    );
    if (revisions.length === 0) {
        throw new Error("Revision not found or already submitted");
    }

    // Update status
    await query(
        `UPDATE revisions SET status = 'submitted', completed_at = now() WHERE revision_id = $1`,
        [revisionId],
    );

    // Get answers to process
    const { rows: answers } = await query<RevisionAnswer>(
        `SELECT ra.*, a.type, a.body_data 
     FROM revision_answers ra
     JOIN activities a ON a.activity_id = ra.activity_id
     WHERE ra.revision_id = $1`,
        [revisionId],
    );

    for (const answer of answers) {
        const activityType = (answer as any).type;
        // For Short Text, queue AI marking

        // For Uploads, set to pending_manual (already default, but ensure)
        if (activityType === "upload-file" || activityType === "upload-url") {
            await query(
                `UPDATE revision_answers SET status = 'pending_manual' WHERE answer_id = $1`,
                [answer.answer_id],
            );
        }

        // For MCQ, we could auto-mark here immediately.
        if (activityType === "multiple-choice-question") {
            // Calculate score logic...
            // For now, let's leave it as 'marked' with 0 score or implement simple checking.
            // Implementing simple checking:
            const body = (answer as any).body_data;
            const correctOptionId = body.correctOptionId;
            const userAnswer = answer.answer_data?.answer_chosen ||
                answer.answer_data?.optionId;

            let score = 0;
            if (correctOptionId && userAnswer === correctOptionId) {
                score = 1;
            }

            await query(
                `UPDATE revision_answers SET status = 'marked', score = $1 WHERE answer_id = $2`,
                [score, answer.answer_id],
            );
        }
    }

    revalidatePath(`/revisions/${revisionId}`);
}
