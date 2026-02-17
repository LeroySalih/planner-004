"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonActivitySchema,
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
  SubmissionSchema,
  type Submission,
  type LessonActivity,
} from "@/types"
import {
  scoreShortTextAnswers,
  type ShortTextEvaluationResult,
} from "@/lib/ai/short-text-scoring"
import { fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"
import { getActivityLessonId, logActivitySubmissionEvent } from "@/lib/activity-logging"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { enqueueMarkingTasks, triggerQueueProcessor } from "@/lib/ai/marking-queue"
import { query } from "@/lib/db"
import { runAiMarkingFlow } from "@/lib/ai/ai-marking-service"

const ShortTextAnswerInputSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1),
  answer: z.string().optional(),
  assignmentId: z.string().optional(),
})

const ShortTextSubmissionsQuerySchema = z.object({
  activity_id: z.string(),
  submission_id: z.string(),
  user_id: z.string(),
  submitted_at: z.union([z.string(), z.date()]).nullable(),
  body: z.unknown().nullable(),
})

const MarkShortTextInputSchema = z.object({
  activityId: z.string().min(1),
  lessonId: z.string().optional(),
})

const ManualAiMarkingInputSchema = z.object({
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  submissionId: z.string().min(1),
  assignmentId: z.string().min(1),
})

const BulkAiMarkingInputSchema = z.object({
  assignmentId: z.string().min(1),
  submissions: z.array(z.object({
    submissionId: z.string().min(1),
  })),
})

const OverrideShortTextScoreSchema = z.object({
  submissionId: z.string().min(1),
  activityId: z.string().min(1),
  lessonId: z.string().optional(),
  overrideScore: z.number().min(0).max(1).nullable(),
})

export interface ShortTextSubmissionView {
  submissionId: string
  activityId: string
  userId: string
  submittedAt: string | null
  answer: string
  aiModelScore: number | null
  teacherOverrideScore: number | null
  isCorrect: boolean
  profile: {
    userId: string
    firstName: string | null
    lastName: string | null
  } | null
}

const SHORT_TEXT_CORRECTNESS_THRESHOLD = 0.8

export async function saveShortTextAnswerAction(input: z.infer<typeof ShortTextAnswerInputSchema>) {
  const payload = ShortTextAnswerInputSchema.parse(input)

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(payload.activityId)
  const initialScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: 0,
  })
  const lessonId = await getActivityLessonId(payload.activityId)

  let existingId: string | null = null
  try {
    const { rows } = await query<{ submission_id: string }>(
      `
        select submission_id
        from submissions
        where activity_id = $1 and user_id = $2
        order by submitted_at desc
        limit 1
      `,
      [payload.activityId, payload.userId],
    )
    existingId = rows[0]?.submission_id ?? null
  } catch (error) {
    console.error("[short-text] Failed to read existing submission:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unable to save submission.", data: null as Submission | null }
  }

  const submissionBody = ShortTextSubmissionBodySchema.parse({
    answer: (payload.answer ?? "").trim(),
    ai_model_score: null,
    ai_model_feedback: null,
    teacher_override_score: null,
    is_correct: false,
    success_criteria_scores: initialScores,
  })

  const timestamp = new Date().toISOString()

  let savedSubmission: Submission | null = null

  try {
    if (existingId) {
      const { rows } = await query(
        `
          update submissions
          set body = $1, submitted_at = $2, is_flagged = false, resubmit_requested = false, resubmit_note = NULL
          where submission_id = $3
          returning *
        `,
        [submissionBody, timestamp, existingId],
      )
      const parsed = SubmissionSchema.safeParse(rows[0])
      if (!parsed.success) {
        console.error("[short-text] Invalid submission payload after update:", parsed.error)
        return { success: false, error: "Invalid submission data.", data: null as Submission | null }
      }
      savedSubmission = parsed.data
    } else {
      const { rows } = await query(
        `
          insert into submissions (activity_id, user_id, body, submitted_at)
          values ($1, $2, $3, $4)
          returning *
        `,
        [payload.activityId, payload.userId, submissionBody, timestamp],
      )

      const parsed = SubmissionSchema.safeParse(rows[0])
      if (!parsed.success) {
        console.error("[short-text] Invalid submission payload after insert:", parsed.error)
        return { success: false, error: "Invalid submission data.", data: null as Submission | null }
      }
      savedSubmission = parsed.data
    }

    if (savedSubmission) {
      // Fire-and-forget logging to avoid blocking the user
      void logActivitySubmissionEvent({
        submissionId: savedSubmission.submission_id,
        activityId: payload.activityId,
        lessonId,
        pupilId: payload.userId,
        fileName: null,
        submittedAt: savedSubmission.submitted_at ?? timestamp,
      })

      // Notify listeners of the update
      void emitSubmissionEvent("submission.updated", {
        submissionId: savedSubmission.submission_id,
        activityId: payload.activityId,
        pupilId: payload.userId,
        submittedAt: savedSubmission.submitted_at ?? timestamp,
        submissionStatus: "inprogress",
        isFlagged: false,
      })

      deferRevalidate(`/lessons/${payload.activityId}`)
      return { success: true, error: null, data: savedSubmission }
    }

    return { success: false, error: "Unable to save submission.", data: null }
  } catch (error) {
    console.error("[short-text] Failed to save submission:", error)
    const message = error instanceof Error ? error.message : "Unable to save submission."
    return { success: false, error: message, data: null as Submission | null }
  }
}

export async function triggerManualAiMarkingAction(input: z.infer<typeof ManualAiMarkingInputSchema>) {
  const payload = ManualAiMarkingInputSchema.parse(input)
  
  await enqueueMarkingTasks(payload.assignmentId, [{ submissionId: payload.submissionId }]);
  void triggerQueueProcessor();

  return { success: true }
}

export async function triggerBulkAiMarkingAction(input: z.infer<typeof BulkAiMarkingInputSchema>) {
  const payload = BulkAiMarkingInputSchema.parse(input)
  
  await enqueueMarkingTasks(payload.assignmentId, payload.submissions);
  void triggerQueueProcessor();

  return { success: true }
}

export async function listShortTextSubmissionsAction(activityId: string) {
  try {
    const { rows } = await query(
      `
        select submission_id, activity_id, user_id, submitted_at, body
        from submissions
        where activity_id = $1
        order by submitted_at desc
      `,
      [activityId],
    )

    const parsed = ShortTextSubmissionsQuerySchema.array().parse(rows ?? [])

    return {
      success: true as const,
      error: null,
      submissions: parsed,
    }
  } catch (error) {
    console.error("[short-text] Failed to list submissions:", error)
    const message = error instanceof Error ? error.message : "Unable to load submissions."
    return {
      success: false as const,
      error: message,
      submissions: [],
    }
  }
}

export async function markShortTextActivityAction(input: z.infer<typeof MarkShortTextInputSchema>) {
  const payload = MarkShortTextInputSchema.parse(input)

  try {
    const { rows } = await query(
      `
        select activity_id, body_data
        from activities
        where activity_id = $1
        limit 1
      `,
      [payload.activityId],
    )
    const activity = rows[0] ?? null

    if (!activity) {
      return { success: false, error: "Activity not found." }
    }

    const parsedActivity = LessonActivitySchema.safeParse(activity)
    if (!parsedActivity.success) {
      return { success: false, error: "Invalid activity data." }
    }

    const { data, error } = await markShortTextActivityHelper(parsedActivity.data)

    if (error) {
      return { success: false, error, data: null as Submission | null }
    }

    deferRevalidate(`/lessons/${payload.lessonId ?? ""}`)
    return { success: true, error: null, data }
  } catch (error) {
    console.error("[short-text] Failed to mark short text activity:", error)
    const message = error instanceof Error ? error.message : "Unable to mark activity."
    return { success: false, error: message, data: null as Submission | null }
  }
}

export async function overrideShortTextSubmissionScoreAction(
  input: z.infer<typeof OverrideShortTextScoreSchema>,
) {
  const payload = OverrideShortTextScoreSchema.parse(input)

  try {
    const { rows: submissionRows } = await query(
      `
        select submission_id, activity_id, user_id, submitted_at, body
        from submissions
        where submission_id = $1
        limit 1
      `,
      [payload.submissionId],
    )
    const submissionRow = submissionRows[0] ?? null

    if (!submissionRow) {
      return { success: false, error: "Submission not found." }
    }

    const parsedSubmission = ShortTextSubmissionBodySchema.safeParse(submissionRow.body)
    if (!parsedSubmission.success) {
      return { success: false, error: "Invalid submission payload.", data: null }
    }

    const successCriteriaIds = await fetchActivitySuccessCriteriaIds(payload.activityId)
    const normalizedScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      existingScores: parsedSubmission.data.success_criteria_scores,
      fillValue: payload.overrideScore,
    })

    const updatedBody = ShortTextSubmissionBodySchema.parse({
      ...parsedSubmission.data,
      teacher_override_score: payload.overrideScore,
      success_criteria_scores: normalizedScores,
      is_correct: payload.overrideScore !== null ? payload.overrideScore >= SHORT_TEXT_CORRECTNESS_THRESHOLD : false,
    })

    const { rows } = await query(
      `
        update submissions
        set body = $1
        where submission_id = $2
        returning *
      `,
      [updatedBody, payload.submissionId],
    )

    const savedRow = rows[0] ?? null
    if (!savedRow) {
      return { success: false, error: "Unable to update submission.", data: null }
    }

    deferRevalidate(`/lessons/${payload.lessonId ?? ""}`)

    return {
      success: true,
      error: null,
      data: SubmissionSchema.parse(savedRow),
    }
  } catch (error) {
    console.error("[short-text] Failed to override submission score:", error)
    const message = error instanceof Error ? error.message : "Unable to update submission."
    return { success: false, error: message, data: null }
  }
}

const ToggleSubmissionFlagInputSchema = z.object({
  submissionId: z.string().min(1),
  isFlagged: z.boolean(),
  path: z.string().optional(),
})

export async function toggleSubmissionFlagAction(input: z.infer<typeof ToggleSubmissionFlagInputSchema>) {
  const payload = ToggleSubmissionFlagInputSchema.parse(input)

  try {
    const { rows } = await query(
      `
        update submissions 
        set is_flagged = $1 
        where submission_id = $2
        returning activity_id, user_id, submitted_at, body
      `,
      [payload.isFlagged, payload.submissionId],
    )

    const updated = rows[0]
    if (updated) {
      void emitSubmissionEvent("submission.updated", {
        submissionId: payload.submissionId,
        activityId: updated.activity_id,
        pupilId: updated.user_id,
        submittedAt:
          updated.submitted_at instanceof Date ? updated.submitted_at.toISOString() : updated.submitted_at,
        body: updated.body,
        isFlagged: payload.isFlagged,
      })
    }

    if (payload.path) {
      revalidatePath(payload.path)
    }

    return { success: true, error: null }
  } catch (error) {
    console.error("[short-text] Failed to toggle submission flag:", error)
    return { success: false, error: "Unable to update flag." }
  }
}

async function markShortTextActivityHelper(activity: LessonActivity) {
  const parsedActivityBody = ShortTextActivityBodySchema.safeParse(activity.body_data)

  if (!parsedActivityBody.success) {
    return {
      success: false as const,
      error: "Invalid activity body.",
      data: null as Submission | null,
    }
  }

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(activity.activity_id)

  let submission: Submission | null = null
  try {
    const { rows } = await query(
      `
        select submission_id, activity_id, user_id, submitted_at, body
        from submissions
        where activity_id = $1
        order by submitted_at desc
        limit 1
      `,
      [activity.activity_id],
    )
    const row = rows[0] ?? null
    submission =
      row && typeof row.submission_id === "string"
        ? (row as Submission)
        : null
  } catch (error) {
    console.error("[short-text] Failed to load submission for scoring:", error)
    return { success: false as const, error: "Unable to load submission.", data: null }
  }

  if (!submission) {
    return {
      success: false as const,
      error: "No submission to score.",
      data: null,
    }
  }

  const parsedSubmission = ShortTextSubmissionBodySchema.safeParse(submission.body)
  if (!parsedSubmission.success) {
    return {
      success: false as const,
      error: "Invalid submission payload.",
      data: null,
    }
  }

  let scored: ShortTextEvaluationResult[] = []
  try {
    scored = await scoreShortTextAnswers(
      parsedActivityBody.data.question,
      parsedActivityBody.data.modelAnswer,
      [
        {
          submissionId: submission.submission_id,
          answer: parsedSubmission.data.answer,
        },
      ],
    )
  } catch (error) {
    console.error("[short-text] Failed to score short text answers:", error)
    return { success: false as const, error: "Unable to score submission.", data: null }
  }

  const scoredResult = scored[0]
  const normalizedScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    existingScores: parsedSubmission.data.success_criteria_scores,
    fillValue: scoredResult.score,
  })

  const updatedBody = ShortTextSubmissionBodySchema.parse({
    ...parsedSubmission.data,
    ai_model_score: scoredResult.score,
    ai_model_feedback: null,
    is_correct: (scoredResult.score ?? 0) >= SHORT_TEXT_CORRECTNESS_THRESHOLD,
    success_criteria_scores: normalizedScores,
  })

  try {
    const { rows } = await query(
      `
        update submissions
        set body = $1
        where submission_id = $2
        returning *
      `,
      [updatedBody, submission.submission_id],
    )

    const savedRow = rows[0] ?? null

    return {
      success: true as const,
      error: null,
      data: savedRow ? SubmissionSchema.parse(savedRow) : null,
    }
  } catch (error) {
    console.error("[short-text] Failed to persist scored submission:", error)
    return { success: false as const, error: "Unable to save scored submission.", data: null }
  }
}
const deferRevalidate = (path: string) => {
  if (path.includes("/lessons/")) {
    return
  }
  queueMicrotask(() => revalidatePath(path))
}
