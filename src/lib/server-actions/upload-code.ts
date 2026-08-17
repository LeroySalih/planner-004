"use server"

import { z } from "zod"

import { query } from "@/lib/db"
import { requireAuthenticatedProfile } from "@/lib/auth"
import {
  type Submission,
  SubmissionSchema,
  UploadCodeSubmissionBodySchema,
} from "@/types"
import { fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"
import { getActivityLessonId, logActivitySubmissionEvent } from "@/lib/activity-logging"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { clearResubmitRequest, getNextAttemptNumber } from "@/lib/server-actions/submission-attempts"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { withTelemetry } from "@/lib/telemetry"

const SubmitCodeInputSchema = z.object({
  activityId: z.string().min(1),
  code: z.string(),
  assignmentId: z.string().min(1).nullable().optional(),
})

/**
 * Save a pupil's source and queue it for AI marking.
 *
 * Unlike short-text this does NOT debounce: code is submitted deliberately with
 * a button rather than saved as the pupil types, so there is no stream of
 * keystroke saves to collapse and no reason to make them wait.
 */
export async function submitCodeAction(input: z.infer<typeof SubmitCodeInputSchema>) {
  return withTelemetry(
    { routeTag: "/upload-code:submit", functionName: "submitCodeAction", params: { activityId: input.activityId } },
    async () => {
      const payload = SubmitCodeInputSchema.parse(input)
      const profile = await requireAuthenticatedProfile()

      const code = payload.code ?? ""
      if (code.trim().length === 0) {
        return { success: false, error: "Write some code before submitting.", data: null as Submission | null }
      }

      const successCriteriaIds = await fetchActivitySuccessCriteriaIds(payload.activityId)
      const lessonId = await getActivityLessonId(payload.activityId)

      const submissionBody = UploadCodeSubmissionBodySchema.parse({
        code,
        ai_model_score: null,
        ai_model_feedback: null,
        teacher_override_score: null,
        is_correct: false,
        success_criteria_scores: normaliseSuccessCriteriaScores({ successCriteriaIds, fillValue: 0 }),
      })

      const timestamp = new Date().toISOString()

      try {
        const attemptNumber = await getNextAttemptNumber(payload.activityId, profile.userId)

        const { rows } = await query(
          `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at)
           values ($1, $2, $3, $4, $5)
           returning *`,
          [payload.activityId, profile.userId, attemptNumber, submissionBody, timestamp],
        )

        const parsed = SubmissionSchema.safeParse(rows[0])
        if (!parsed.success) {
          console.error("[upload-code] Invalid submission after insert:", parsed.error)
          return { success: false, error: "Invalid submission data.", data: null as Submission | null }
        }
        const saved = parsed.data

        await clearResubmitRequest(payload.activityId, profile.userId)

        // Drop stale AI feedback so a resubmission shows "being marked" rather
        // than the previous attempt's comments.
        void query(
          `delete from pupil_activity_feedback where activity_id = $1 and pupil_id = $2 and source = 'ai'`,
          [payload.activityId, profile.userId],
        ).catch((err) => console.error("[upload-code] Failed to clear stale AI feedback:", err))

        void logActivitySubmissionEvent({
          submissionId: saved.submission_id,
          activityId: payload.activityId,
          lessonId,
          pupilId: profile.userId,
          fileName: null,
          submittedAt: saved.submitted_at ?? timestamp,
        })

        void emitSubmissionEvent("submission.updated", {
          submissionId: saved.submission_id,
          activityId: payload.activityId,
          pupilId: profile.userId,
          submittedAt: saved.submitted_at ?? timestamp,
          submissionStatus: "inprogress",
          isFlagged: false,
        })

        if (payload.assignmentId) {
          void enqueueMarkingTasks(payload.assignmentId, [{ submissionId: saved.submission_id }])
            .then(() => {
              void emitSubmissionEvent("submission.updated", {
                submissionId: saved.submission_id,
                activityId: payload.activityId,
                pupilId: profile.userId,
                markStatus: "waiting",
              })
              void triggerQueueProcessor()
            })
            .catch((err) => console.error("[upload-code] Failed to enqueue AI marking:", err))
        }

        return { success: true, error: null, data: saved }
      } catch (error) {
        console.error("[upload-code] Failed to save submission:", error)
        const message = error instanceof Error ? error.message : "Unable to save submission."
        return { success: false, error: message, data: null as Submission | null }
      }
    },
  )
}

/** The caller's latest submission for an upload-code activity. */
export async function readMyCodeSubmissionAction(activityId: string) {
  const profile = await requireAuthenticatedProfile()

  try {
    const { rows } = await query<{ submission_id: string; body: unknown; submitted_at: string | null }>(
      `select submission_id, body, submitted_at
       from submissions
       where activity_id = $1 and user_id = $2
       order by attempt_number desc
       limit 1`,
      [activityId, profile.userId],
    )

    const row = rows[0]
    if (!row) return { data: null, error: null }

    const body = UploadCodeSubmissionBodySchema.safeParse(row.body ?? {})
    return {
      data: {
        submissionId: row.submission_id,
        code: body.success ? body.data.code : "",
        submittedAt: row.submitted_at,
      },
      error: null,
    }
  } catch (error) {
    console.error("[upload-code] Failed to read submission:", error)
    return { data: null, error: "Unable to load your submission." }
  }
}
