"use server";

import { performance } from "node:perf_hooks";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
} from "@/types";
import { query } from "@/lib/db";
import { requireTeacherProfile } from "@/lib/auth";
import {
  fetchActivitySuccessCriteriaIds,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria";
import { withTelemetry } from "@/lib/telemetry";
import { insertPupilActivityFeedbackEntry } from "@/lib/feedback/pupil-activity-feedback";

const RequestResubmissionInputSchema = z.object({
  assignmentId: z.string().min(3),
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  submissionId: z.string().min(1).nullable(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const RequestResubmissionReturnSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
});

export async function requestResubmissionAction(
  input: z.infer<typeof RequestResubmissionInputSchema>,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const teacherProfile = await requireTeacherProfile();
  const authEndTime = options?.authEndTime ?? performance.now();
  const routeTag = options?.routeTag ?? "/results/assignments:resubmit";

  return withTelemetry(
    {
      routeTag,
      functionName: "requestResubmissionAction",
      params: {
        assignmentId: input.assignmentId,
        activityId: input.activityId,
        pupilId: input.pupilId,
      },
      authEndTime,
    },
    async () => {
      const parsed = RequestResubmissionInputSchema.safeParse(input);
      if (!parsed.success) {
        return RequestResubmissionReturnSchema.parse({
          success: false,
          error: "Invalid resubmission payload.",
        });
      }

      try {
        // Validate activity exists
        const { rows: activityRows } = await query(
          "select activity_id, type from activities where activity_id = $1 limit 1",
          [parsed.data.activityId],
        );
        const activityRow = activityRows?.[0] ?? null;

        if (!activityRow) {
          return RequestResubmissionReturnSchema.parse({
            success: false,
            error: "Activity not found.",
          });
        }

        // Find submission
        let submissionId: string | null = null;
        let body: Record<string, unknown> = {};

        if (parsed.data.submissionId) {
          const { rows } = await query<{ submission_id: string; body: unknown }>(
            "select submission_id, body from submissions where submission_id = $1 limit 1",
            [parsed.data.submissionId],
          );
          if (rows?.[0]) {
            submissionId = rows[0].submission_id;
            body = (rows[0].body as Record<string, unknown>) ?? {};
          }
        }

        if (!submissionId) {
          const { rows } = await query<{ submission_id: string; body: unknown }>(
            `select submission_id, body from submissions
             where activity_id = $1 and user_id = $2
             order by submitted_at desc nulls last limit 1`,
            [parsed.data.activityId, parsed.data.pupilId],
          );
          if (rows?.[0]) {
            submissionId = rows[0].submission_id;
            body = (rows[0].body as Record<string, unknown>) ?? {};
          }
        }

        if (!submissionId) {
          return RequestResubmissionReturnSchema.parse({
            success: false,
            error: "Submission not found for this pupil.",
          });
        }

        // Zero out the score in the submission body
        const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
          parsed.data.activityId,
        );
        const type = typeof activityRow.type === "string"
          ? activityRow.type.trim()
          : "";

        let nextBody: Record<string, unknown> = {};

        if (body && typeof body === "object") {
          const zeroScores = normaliseSuccessCriteriaScores({
            successCriteriaIds,
            fillValue: 0,
          });

          if (type === "multiple-choice-question") {
            const parsedBody = McqSubmissionBodySchema.safeParse(body);
            if (parsedBody.success) {
              nextBody = {
                ...body,
                is_correct: false,
                teacher_override_score: null,
                teacher_feedback: null,
                success_criteria_scores: zeroScores,
              };
            } else {
              nextBody = {
                ...body,
                teacher_override_score: null,
                teacher_feedback: null,
                success_criteria_scores: zeroScores,
              };
            }
          } else if (type === "short-text-question") {
            const parsedBody = ShortTextSubmissionBodySchema.safeParse(body);
            if (parsedBody.success) {
              nextBody = {
                ...body,
                ai_model_score: null,
                ai_model_feedback: null,
                is_correct: false,
                teacher_override_score: null,
                teacher_feedback: null,
                success_criteria_scores: zeroScores,
              };
            } else {
              nextBody = {
                ...body,
                teacher_override_score: null,
                teacher_feedback: null,
                success_criteria_scores: zeroScores,
              };
            }
          } else {
            nextBody = {
              ...body,
              teacher_override_score: null,
              teacher_feedback: null,
              success_criteria_scores: zeroScores,
            };
          }
        } else {
          const zeroScores = normaliseSuccessCriteriaScores({
            successCriteriaIds,
            fillValue: 0,
          });
          nextBody = {
            teacher_override_score: null,
            teacher_feedback: null,
            success_criteria_scores: zeroScores,
          };
        }

        // Update submission: set resubmit flag, zero body, clear score
        try {
          await query(
            `update submissions
             set body = $1,
                 resubmit_requested = true,
                 resubmit_note = $2
             where submission_id = $3`,
            [nextBody, parsed.data.note?.trim() || null, submissionId],
          );
        } catch (updateError) {
          console.error(
            "[resubmit] Failed to set resubmit on submission:",
            updateError,
          );
          return RequestResubmissionReturnSchema.parse({
            success: false,
            error: "Unable to request resubmission.",
          });
        }

        // Record feedback entry for audit trail
        await insertPupilActivityFeedbackEntry({
          activityId: parsed.data.activityId,
          pupilId: parsed.data.pupilId,
          submissionId,
          source: "teacher",
          score: null,
          feedbackText: parsed.data.note?.trim() || null,
          createdBy: teacherProfile.userId,
        });

        revalidatePath(`/results/assignments/${parsed.data.assignmentId}`);

        return RequestResubmissionReturnSchema.parse({
          success: true,
          error: null,
        });
      } catch (error) {
        console.error(
          "[resubmit] Unexpected error requesting resubmission:",
          error,
        );
        return RequestResubmissionReturnSchema.parse({
          success: false,
          error: "Unable to request resubmission.",
        });
      }
    },
  );
}
