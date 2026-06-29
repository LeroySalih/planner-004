"use server";

import { performance } from "node:perf_hooks";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { query } from "@/lib/db";
import { requireTeacherProfile } from "@/lib/auth";
import { withTelemetry } from "@/lib/telemetry";
import { insertPupilActivityFeedbackEntry } from "@/lib/feedback/pupil-activity-feedback";
import { setResubmitRequest } from "@/lib/server-actions/submission-attempts";

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
        const { rows: activityRows } = await query(
          "select activity_id from activities where activity_id = $1 limit 1",
          [parsed.data.activityId],
        );
        if (!activityRows?.[0]) {
          return RequestResubmissionReturnSchema.parse({
            success: false,
            error: "Activity not found.",
          });
        }

        let submissionId: string | null = parsed.data.submissionId ?? null;
        if (!submissionId) {
          const { rows } = await query<{ submission_id: string }>(
            `select submission_id from submissions
             where activity_id = $1 and user_id = $2
             order by attempt_number desc limit 1`,
            [parsed.data.activityId, parsed.data.pupilId],
          );
          submissionId = rows?.[0]?.submission_id ?? null;
        }

        if (!submissionId) {
          return RequestResubmissionReturnSchema.parse({
            success: false,
            error: "Submission not found for this pupil.",
          });
        }

        await setResubmitRequest({
          activityId: parsed.data.activityId,
          userId: parsed.data.pupilId,
          note: parsed.data.note?.trim() || null,
          requestedBy: teacherProfile.userId,
        });

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
