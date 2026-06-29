"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
    type Submission,
    SubmissionSchema,
    UploadUrlActivityBodySchema,
    UploadUrlSubmissionBodySchema,
} from "@/types";
import {
    fetchActivitySuccessCriteriaIds,
    normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria";
import {
    getActivityLessonId,
    logActivitySubmissionEvent,
} from "@/lib/activity-logging";
import { emitSubmissionEvent } from "@/lib/sse/topics";
import { query } from "@/lib/db";
import {
    clearResubmitRequest,
    getNextAttemptNumber,
} from "@/lib/server-actions/submission-attempts";

const UploadUrlAnswerInputSchema = z.object({
    activityId: z.string().min(1),
    userId: z.string().min(1),
    url: z.string().url(),
    assignmentId: z.string().optional(),
});

export async function saveUploadUrlAnswerAction(
    input: z.infer<typeof UploadUrlAnswerInputSchema>,
) {
    const payload = UploadUrlAnswerInputSchema.parse(input);

    const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
        payload.activityId,
    );
    const initialScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: 0,
    });
    const lessonId = await getActivityLessonId(payload.activityId);

    const submissionBody = UploadUrlSubmissionBodySchema.parse({
        url: (payload.url ?? "").trim(),
        teacher_feedback: null,
        success_criteria_scores: initialScores,
    });

    const timestamp = new Date().toISOString();

    let savedSubmission: Submission | null = null;

    try {
        const attemptNumber = await getNextAttemptNumber(
            payload.activityId,
            payload.userId,
        );

        const { rows } = await query(
            `
          insert into submissions (activity_id, user_id, attempt_number, body, submitted_at)
          values ($1, $2, $3, $4, $5)
          returning *
        `,
            [
                payload.activityId,
                payload.userId,
                attemptNumber,
                submissionBody,
                timestamp,
            ],
        );

        const parsed = SubmissionSchema.safeParse(rows[0]);
        if (!parsed.success) {
            console.error(
                "[upload-url] Invalid submission payload after insert:",
                parsed.error,
            );
            return {
                success: false,
                error: "Invalid submission data.",
                data: null as Submission | null,
            };
        }
        savedSubmission = parsed.data;

        await clearResubmitRequest(payload.activityId, payload.userId);

        if (savedSubmission) {
            // Fire-and-forget logging to avoid blocking the user
            void logActivitySubmissionEvent({
                submissionId: savedSubmission.submission_id,
                activityId: payload.activityId,
                lessonId,
                pupilId: payload.userId,
                fileName: null,
                submittedAt: savedSubmission.submitted_at ?? timestamp,
            });

            // Notify listeners of the update
            void emitSubmissionEvent("submission.updated", {
                submissionId: savedSubmission.submission_id,
                activityId: payload.activityId,
                pupilId: payload.userId,
                submittedAt: savedSubmission.submitted_at ?? timestamp,
                submissionStatus: "inprogress",
                isFlagged: false,
            });

            deferRevalidate(`/lessons/${payload.activityId}`);
            return { success: true, error: null, data: savedSubmission };
        }

        return {
            success: false,
            error: "Unable to save submission.",
            data: null,
        };
    } catch (error) {
        console.error("[upload-url] Failed to save submission:", error);
        const message = error instanceof Error
            ? error.message
            : "Unable to save submission.";
        return {
            success: false,
            error: message,
            data: null as Submission | null,
        };
    }
}

const deferRevalidate = (path: string) => {
    if (path.includes("/lessons/")) {
        return;
    }
    queueMicrotask(() => revalidatePath(path));
};
