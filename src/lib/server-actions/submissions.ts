"use server"

import { z } from "zod"

import {
  McqActivityBodySchema,
  McqSubmissionBodySchema,
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
  SubmissionSchema,
  type LessonSubmissionSummary,
  type Submission,
} from "@/types"
import { query } from "@/lib/db"
import { isScorableActivityType } from "@/dino.config"
import {
  computeAverageSuccessCriteriaScore,
  fetchActivitySuccessCriteriaIds,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria"
import { getActivityLessonId, logActivitySubmissionEvent } from "@/lib/server-actions/activity-submission-events"

const SubmissionResultSchema = z.object({
  data: SubmissionSchema.nullable(),
  error: z.string().nullable(),
})

const McqSubmissionInputSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1),
  optionId: z.string().min(1),
})

const LessonActivitySummaryRowSchema = z.object({
  activity_id: z.string(),
  title: z.string().nullable(),
  type: z.string().nullable(),
  body_data: z.unknown().nullable(),
  is_summative: z.boolean().nullish().transform((value) => value ?? false),
})

export async function getLatestSubmissionForActivityAction(activityId: string, userId: string) {
  const input = McqSubmissionInputSchema.pick({ activityId: true, userId: true }).parse({
    activityId,
    userId,
  })

  let row: any = null
  try {
    const { rows } = await query(
      `
        select *
        from submissions
        where activity_id = $1 and user_id = $2
        order by submitted_at desc
        limit 1
      `,
      [input.activityId, input.userId],
    )
    row = rows[0] ?? null
  } catch (error) {
    console.error("[submissions] Failed to load submission:", error)
    const message = error instanceof Error ? error.message : "Unable to load submission."
    return SubmissionResultSchema.parse({ data: null, error: message })
  }

  if (!row) {
    return SubmissionResultSchema.parse({ data: null, error: null })
  }

  const parsed = SubmissionSchema.safeParse(row)
  if (!parsed.success) {
    console.error("[submissions] Failed to parse submission row:", parsed.error)
    return SubmissionResultSchema.parse({ data: null, error: "Invalid submission data." })
  }

  return SubmissionResultSchema.parse({ data: parsed.data, error: null })
}

type LessonAverageBreakdown = {
  activitiesAverage: number | null
  assessmentAverage: number | null
}

export async function readLessonSubmissionSummariesAction(
  lessonId: string,
  options: { userId?: string | null } = {},
): Promise<{ data: LessonSubmissionSummary[]; averages: LessonAverageBreakdown; error: string | null }> {
  const trimmedLessonId = lessonId.trim()
  if (!trimmedLessonId) {
    return { data: [], averages: { activitiesAverage: null, assessmentAverage: null }, error: null }
  }

  try {
    const viewerUserId = options.userId ?? null
    let activityRows: any[] = []
    try {
      const { rows } = await query(
        `
          select activity_id, title, type, body_data, active, is_summative
          from activities
          where lesson_id = $1 and active = true
        `,
        [trimmedLessonId],
      )
      activityRows = rows ?? []
    } catch (activitiesError) {
      console.error("[submissions] Failed to read lesson activities for feedback summary:", activitiesError)
      return {
        data: [],
        averages: { activitiesAverage: null, assessmentAverage: null },
        error: activitiesError instanceof Error ? activitiesError.message : "Unable to load activities.",
      }
    }

    const activities = LessonActivitySummaryRowSchema.array().parse(activityRows ?? [])
    const scorableActivities = activities.filter((activity) => isScorableActivityType(activity.type))

  if (scorableActivities.length === 0) {
    return { data: [], averages: { activitiesAverage: null, assessmentAverage: null }, error: null }
  }

  const activityIds = scorableActivities.map((activity) => activity.activity_id)

  const activitySuccessCriteriaMap = new Map<string, string[]>()

    if (activityIds.length > 0) {
      try {
        const { rows: activityCriteriaRows } = await query<{
          activity_id: string
          success_criteria_id: string
        }>(
          `
            select activity_id, success_criteria_id
            from activity_success_criteria
            where activity_id = any($1::text[])
          `,
          [activityIds],
        )

        for (const row of activityCriteriaRows ?? []) {
          const activityId = typeof row?.activity_id === "string" ? row.activity_id : null
          const successCriteriaId =
            typeof row?.success_criteria_id === "string" ? row.success_criteria_id : null
          if (!activityId || !successCriteriaId) continue

          const list = activitySuccessCriteriaMap.get(activityId) ?? []
          list.push(successCriteriaId)
          activitySuccessCriteriaMap.set(activityId, list)
        }
      } catch (activityCriteriaError) {
        console.error(
          "[submissions] Failed to load activity success criteria for summaries:",
          activityCriteriaError,
        )
      }
    }

    let submissionRows: any[] = []
    try {
      const { rows } = await query(
        `
          select submission_id, activity_id, user_id, submitted_at, body
          from submissions
          where activity_id = any($1::text[])
        `,
        [activityIds],
      )
      submissionRows = rows ?? []
    } catch (submissionsError) {
      console.error("[submissions] Failed to read lesson submissions for feedback summary:", submissionsError)
      return {
        data: [],
        averages: { activitiesAverage: null, assessmentAverage: null },
        error: submissionsError instanceof Error ? submissionsError.message : "Unable to load submissions.",
      }
    }

    const submissions = SubmissionSchema.array().parse(submissionRows ?? [])
    const submissionsByActivity = new Map<string, Submission[]>()

    for (const submission of submissions) {
      const list = submissionsByActivity.get(submission.activity_id) ?? []
      list.push(submission)
      submissionsByActivity.set(submission.activity_id, list)
    }

    const summaries: LessonSubmissionSummary[] = []
  const overallTotals = { total: 0, count: 0 }
  const overallSummativeTotals = { total: 0, count: 0 }
  const viewerTotals = { total: 0, count: 0 }
  const viewerSummativeTotals = { total: 0, count: 0 }

    for (const activity of scorableActivities) {
      const activityType = (activity.type ?? "").trim()
      const activityTitle = (activity.title ?? "Untitled activity").trim() || "Untitled activity"
      const submissionList = submissionsByActivity.get(activity.activity_id) ?? []
      const successCriteriaIds = activitySuccessCriteriaMap.get(activity.activity_id) ?? []
      const isSummative = activity.is_summative ?? false

      const summary: LessonSubmissionSummary = {
        activityId: activity.activity_id,
        activityTitle,
        activityType,
        successCriteriaIds: successCriteriaIds.slice(),
        totalSubmissions: submissionList.length,
        averageScore: null,
        correctCount: null,
        scores: [],
        correctAnswer: null,
        isSummative,
      }

      if (submissionList.length === 0) {
        summaries.push(summary)
        continue
      }

      if (activityType === "multiple-choice-question") {
        const parsedActivity = McqActivityBodySchema.safeParse(activity.body_data)
        const mcqOptions = parsedActivity.success ? parsedActivity.data.options : []
        const correctOptionId = parsedActivity.success ? parsedActivity.data.correctOptionId : null
        const correctOption = correctOptionId
          ? mcqOptions.find((option) => option.id === correctOptionId)
          : undefined

        if (correctOption) {
          summary.correctAnswer = correctOption.text?.trim() || correctOptionId
        } else if (correctOptionId) {
          summary.correctAnswer = correctOptionId
        }

        const scoreEntries = submissionList
          .map((submission) => {
            const parsedSubmission = McqSubmissionBodySchema.safeParse(submission.body)
            if (!parsedSubmission.success) {
              return null
            }
            const isCorrect = parsedSubmission.data.is_correct === true
            const overrideScore =
              typeof parsedSubmission.data.teacher_override_score === "number" &&
              Number.isFinite(parsedSubmission.data.teacher_override_score)
                ? parsedSubmission.data.teacher_override_score
                : null
            const effectiveScore = overrideScore ?? (isCorrect ? 1 : 0)
            const successCriteriaScores = normaliseSuccessCriteriaScores({
              successCriteriaIds,
              existingScores: parsedSubmission.data.success_criteria_scores,
              fillValue: effectiveScore,
            })
            const score = computeAverageSuccessCriteriaScore(successCriteriaScores) ?? 0
            return {
              userId: submission.user_id,
              score,
              isCorrect,
              successCriteriaScores,
            }
          })
          .filter(
            (entry): entry is {
              userId: string
              score: number
              isCorrect: boolean
              successCriteriaScores: Record<string, number | null>
            } => entry !== null,
          )

        summary.scores = scoreEntries.map((entry) => ({
          userId: entry.userId,
          score: entry.score,
          isCorrect: entry.isCorrect,
          successCriteriaScores: entry.successCriteriaScores,
        }))
        summary.correctCount = scoreEntries.filter((entry) => entry.isCorrect).length

        if (scoreEntries.length > 0) {
          const activitiesScore = scoreEntries.reduce((acc, entry) => acc + entry.score, 0)
          const averageScore = activitiesScore / scoreEntries.length
          summary.averageScore = averageScore
          overallTotals.total += activitiesScore
          overallTotals.count += scoreEntries.length
          if (isSummative) {
            overallSummativeTotals.total += activitiesScore
            overallSummativeTotals.count += scoreEntries.length
          }
          if (viewerUserId) {
            scoreEntries
              .filter((entry) => entry.userId === viewerUserId)
              .forEach((entry) => {
                viewerTotals.total += entry.score
                viewerTotals.count += 1
              })
            if (isSummative) {
              scoreEntries
                .filter((entry) => entry.userId === viewerUserId)
                .forEach((entry) => {
                  viewerSummativeTotals.total += entry.score
                  viewerSummativeTotals.count += 1
                })
            }
          }
        }
      } else if (activityType === "short-text-question") {
        const parsedActivity = ShortTextActivityBodySchema.safeParse(activity.body_data)
        if (parsedActivity.success) {
          const modelAnswer = parsedActivity.data.modelAnswer?.trim()
          if (modelAnswer) {
            summary.correctAnswer = modelAnswer
          }
        }

        const scoreEntries = submissionList
          .map((submission) => {
            const parsedSubmission = ShortTextSubmissionBodySchema.safeParse(submission.body)
            if (!parsedSubmission.success) {
              return null
            }

            const aiScore =
              typeof parsedSubmission.data.ai_model_score === "number"
              && Number.isFinite(parsedSubmission.data.ai_model_score)
                ? parsedSubmission.data.ai_model_score
                : null
            const overrideScore =
              typeof parsedSubmission.data.teacher_override_score === "number"
              && Number.isFinite(parsedSubmission.data.teacher_override_score)
                ? parsedSubmission.data.teacher_override_score
                : null
            const effectiveScore = overrideScore ?? aiScore
            const successCriteriaScores = normaliseSuccessCriteriaScores({
              successCriteriaIds,
              existingScores: parsedSubmission.data.success_criteria_scores,
              fillValue: effectiveScore ?? 0,
            })
            const averagedScore = computeAverageSuccessCriteriaScore(successCriteriaScores) ?? 0

            return {
              userId: submission.user_id,
              score: averagedScore,
              isCorrect: parsedSubmission.data.is_correct === true,
              successCriteriaScores,
            }
          })
          .filter(
            (entry): entry is {
              userId: string
              score: number
              isCorrect: boolean
              successCriteriaScores: Record<string, number | null>
            } => entry !== null,
          )

        summary.scores = scoreEntries.map((entry) => ({
          userId: entry.userId,
          score: entry.score,
          isCorrect: entry.isCorrect,
          successCriteriaScores: entry.successCriteriaScores,
        }))

        summary.correctCount = scoreEntries.filter((entry) => entry.isCorrect).length

        const numericScores = scoreEntries
          .filter((entry) => typeof entry.score === "number" && Number.isFinite(entry.score))
          .map((entry) => ({
            userId: entry.userId,
            score: entry.score as number,
            isCorrect: entry.isCorrect,
            successCriteriaScores: entry.successCriteriaScores ?? {},
          }))

        if (numericScores.length > 0) {
          const activitiesScore = numericScores.reduce((acc, entry) => acc + entry.score, 0)
          const averageScore = activitiesScore / numericScores.length
          summary.averageScore = averageScore
          overallTotals.total += activitiesScore
          overallTotals.count += numericScores.length
          if (isSummative) {
            overallSummativeTotals.total += activitiesScore
            overallSummativeTotals.count += numericScores.length
          }
          if (viewerUserId) {
            numericScores
              .filter((entry) => entry.userId === viewerUserId)
              .forEach((entry) => {
                viewerTotals.total += entry.score
                viewerTotals.count += 1
              })
            if (isSummative) {
              numericScores
                .filter((entry) => entry.userId === viewerUserId)
                .forEach((entry) => {
                  viewerSummativeTotals.total += entry.score
                  viewerSummativeTotals.count += 1
                })
            }
          }
        }
      } else {
        const generalScores = submissionList.map((submission) => {
          const body = submission.body
          let overrideScore: number | null = null
          let baseScore: number | null = null
          let successCriteriaScores: Record<string, number | null> | undefined

          if (body && typeof body === "object") {
            const record = body as Record<string, unknown>

            if (!summary.correctAnswer) {
              const correctValue = record.correctAnswer
              if (typeof correctValue === "string" && correctValue.trim().length > 0) {
                summary.correctAnswer = correctValue.trim()
              }
            }

            const override = record.teacher_override_score
            if (typeof override === "number" && Number.isFinite(override)) {
              overrideScore = override
            }

            const rawSuccessCriteria = record.success_criteria_scores
            if (rawSuccessCriteria && typeof rawSuccessCriteria === "object") {
              successCriteriaScores = rawSuccessCriteria as Record<string, number | null>
            }

            const scoreValue = record.score
            if (typeof scoreValue === "number" && Number.isFinite(scoreValue)) {
              baseScore = scoreValue
            } else if (typeof scoreValue === "string") {
              const parsed = Number.parseFloat(scoreValue)
              if (!Number.isNaN(parsed)) {
                baseScore = parsed
              }
            }
          }

          const normalisedScores = normaliseSuccessCriteriaScores({
            successCriteriaIds,
            existingScores: successCriteriaScores,
            fillValue: overrideScore ?? baseScore ?? 0,
          })

          const averagedScore = computeAverageSuccessCriteriaScore(normalisedScores)
          const finalScore = averagedScore ?? overrideScore ?? baseScore ?? null

          return {
            userId: submission.user_id,
            score: finalScore,
            successCriteriaScores: normalisedScores,
          }
        })

        summary.scores = generalScores

        const numericScores = generalScores.filter((entry) => typeof entry.score === "number") as Array<{
          userId: string
          score: number
        }>

        if (numericScores.length > 0) {
          const activitiesScore = numericScores.reduce((acc, entry) => acc + entry.score, 0)
          const averageScore = activitiesScore / numericScores.length
          summary.averageScore = averageScore
          overallTotals.total += activitiesScore
          overallTotals.count += numericScores.length
          if (isSummative) {
            overallSummativeTotals.total += activitiesScore
            overallSummativeTotals.count += numericScores.length
          }
          if (viewerUserId) {
            numericScores
              .filter((entry) => entry.userId === viewerUserId)
              .forEach((entry) => {
                viewerTotals.total += entry.score
                viewerTotals.count += 1
              })
            if (isSummative) {
              numericScores
                .filter((entry) => entry.userId === viewerUserId)
                .forEach((entry) => {
                  viewerSummativeTotals.total += entry.score
                  viewerSummativeTotals.count += 1
                })
            }
          }
        }
      }

      summaries.push(summary)
    }

  const computeAverage = (totals: { total: number; count: number }) =>
    totals.count > 0 ? totals.total / totals.count : null

  const lessonAverages: LessonAverageBreakdown = viewerUserId
    ? {
        activitiesAverage: computeAverage(viewerTotals),
        assessmentAverage: computeAverage(viewerSummativeTotals),
      }
    : {
        activitiesAverage: computeAverage(overallTotals),
        assessmentAverage: computeAverage(overallSummativeTotals),
      }

    return { data: summaries, averages: lessonAverages, error: null }
  } catch (error) {
    console.error("[submissions] Unexpected error building submission summaries:", error)
    return {
      data: [],
      averages: { activitiesAverage: null, assessmentAverage: null },
      error: "Unable to load submission summaries.",
    }
  }
}

export async function upsertMcqSubmissionAction(input: z.infer<typeof McqSubmissionInputSchema>) {
  const payload = McqSubmissionInputSchema.parse(input)
  let activity: { body_data: unknown; lesson_id: string | null } | null = null
  try {
    const { rows } = await query<{ body_data: unknown; lesson_id: string | null }>(
      "select body_data, lesson_id from activities where activity_id = $1 limit 1",
      [payload.activityId],
    )
    activity = rows[0] ?? null
  } catch (error) {
    console.error("[submissions] Failed to load activity for submission:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unable to load activity.", data: null as Submission | null }
  }

  if (!activity) {
    return {
      success: false,
      error: "Activity not found for submission.",
      data: null as Submission | null,
    }
  }

  const parsedActivity = McqActivityBodySchema.safeParse(activity.body_data)
  if (!parsedActivity.success) {
    console.error("[submissions] Invalid MCQ activity body:", parsedActivity.error)
    return { success: false, error: "Question is not configured correctly.", data: null as Submission | null }
  }
  const lessonId = activity.lesson_id ?? (await getActivityLessonId(payload.activityId))

  const mcqBody = parsedActivity.data
  const optionExists = mcqBody.options.some((option) => option.id === payload.optionId)

  if (!optionExists) {
    return { success: false, error: "Selected option is no longer available.", data: null as Submission | null }
  }

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(payload.activityId)
  const isCorrect = mcqBody.correctOptionId === payload.optionId
  const successCriteriaScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: isCorrect ? 1 : 0,
  })

  const submissionBody = McqSubmissionBodySchema.parse({
    answer_chosen: payload.optionId,
    is_correct: isCorrect,
    success_criteria_scores: successCriteriaScores,
    teacher_override_score: null,
    teacher_feedback: null,
  })

  let existingSubmissionId: string | null = null
  try {
    const { rows } = await query(
      `
        select submission_id
        from submissions
        where activity_id = $1
          and user_id = $2
        order by submitted_at desc nulls last
        limit 1
      `,
      [payload.activityId, payload.userId],
    )
    const existingRow = rows?.[0] ?? null
    existingSubmissionId =
      existingRow && typeof existingRow.submission_id === "string" ? existingRow.submission_id : null
  } catch (existingError) {
    console.error("[submissions] Failed to check existing submission:", existingError)
    const message = existingError instanceof Error ? existingError.message : "Unable to load submission."
    return { success: false, error: message, data: null as Submission | null }
  }

  const timestamp = new Date().toISOString()

  if (existingSubmissionId) {
    try {
      const { rows } = await query(
        `
          update submissions
          set body = $1, submitted_at = $2, is_flagged = false
          where submission_id = $3
          returning *
        `,
        [submissionBody, timestamp, existingSubmissionId],
      )

      const parsed = SubmissionSchema.safeParse(rows?.[0])
      if (!parsed.success) {
        console.error("[submissions] Failed to parse updated submission:", parsed.error)
        return { success: false, error: "Invalid submission data.", data: null as Submission | null }
      }

      await logActivitySubmissionEvent({
        submissionId: parsed.data.submission_id,
        activityId: payload.activityId,
        lessonId,
        pupilId: payload.userId,
        fileName: null,
        submittedAt: parsed.data.submitted_at ?? timestamp,
      })

      console.log("[realtime-debug] MCQ submission stored", {
        type: "update",
        activityId: payload.activityId,
        pupilId: payload.userId,
        submissionId: parsed.data.submission_id,
      })

      return { success: true, error: null, data: parsed.data }
    } catch (error) {
      console.error("[submissions] Failed to update submission:", error)
      const message = error instanceof Error ? error.message : "Unable to update submission."
      return { success: false, error: message, data: null as Submission | null }
    }
  }

  try {
    const { rows } = await query(
      `
        insert into submissions (activity_id, user_id, body)
        values ($1, $2, $3)
        returning *
      `,
      [payload.activityId, payload.userId, submissionBody],
    )

    const parsed = SubmissionSchema.safeParse(rows?.[0])
    if (!parsed.success) {
      console.error("[submissions] Failed to parse inserted submission:", parsed.error)
      return { success: false, error: "Invalid submission data.", data: null as Submission | null }
    }

    await logActivitySubmissionEvent({
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      lessonId,
      pupilId: payload.userId,
      fileName: null,
      submittedAt: parsed.data.submitted_at ?? timestamp,
    })

    console.log("[realtime-debug] MCQ submission stored", {
      type: "insert",
      activityId: payload.activityId,
      pupilId: payload.userId,
      submissionId: parsed.data.submission_id,
    })

    return { success: true, error: null, data: parsed.data }
  } catch (error) {
    console.error("[submissions] Failed to insert submission:", error)
    const message = error instanceof Error ? error.message : "Unable to insert submission."
    return { success: false, error: message, data: null as Submission | null }
  }
}
