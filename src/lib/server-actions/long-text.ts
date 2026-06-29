"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LongTextSubmissionBodySchema,
  SubmissionSchema,
  type Submission,
} from "@/types"
import { getActivityLessonId, logActivitySubmissionEvent } from "@/lib/activity-logging"
import {
  fetchActivitySuccessCriteriaIds,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { query } from "@/lib/db"
import {
  clearResubmitRequest,
  getNextAttemptNumber,
} from "@/lib/server-actions/submission-attempts"

const LongTextAnswerInputSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1),
  answer: z.string().optional(),
})

export async function saveLongTextAnswerAction(input: z.infer<typeof LongTextAnswerInputSchema>) {
  const payload = LongTextAnswerInputSchema.parse(input)

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(payload.activityId)
  const initialScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: null,
  })
  const lessonId = await getActivityLessonId(payload.activityId)

  const submissionBody = LongTextSubmissionBodySchema.parse({
    answer: (payload.answer ?? "").trim(),
    success_criteria_scores: initialScores,
    teacher_feedback: null,
  })

  const timestamp = new Date().toISOString()

  try {
    const attemptNumber = await getNextAttemptNumber(payload.activityId, payload.userId)

    const { rows } = await query(
      `
        insert into submissions (activity_id, user_id, body, submitted_at, submission_status, attempt_number)
        values ($1, $2, $3, $4, 'inprogress', $5)
        returning *
      `,
      [payload.activityId, payload.userId, submissionBody, timestamp, attemptNumber],
    )

    const parsed = SubmissionSchema.safeParse(rows[0])
    if (!parsed.success) {
      console.error("[long-text] Invalid submission payload after insert:", parsed.error)
      return { success: false, error: "Invalid submission data.", data: null as Submission | null }
    }

    await clearResubmitRequest(payload.activityId, payload.userId)

    void logActivitySubmissionEvent({
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      lessonId,
      pupilId: payload.userId,
      fileName: null,
      submittedAt: parsed.data.submitted_at ?? timestamp,
    })

    void emitSubmissionEvent("submission.created", {
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      pupilId: payload.userId,
      submittedAt: parsed.data.submitted_at ?? timestamp,
      submissionStatus: "inprogress",
      isFlagged: false,
    })

    deferRevalidate(`/lessons/${payload.activityId}`)
    return { success: true, error: null, data: parsed.data }
  } catch (error) {
    console.error("[long-text] Failed to save submission:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to save submission.",
      data: null as Submission | null,
    }
  }
}
const deferRevalidate = (path: string) => {
  if (path.includes("/lessons/")) {
    return
  }
  queueMicrotask(() => revalidatePath(path))
}
