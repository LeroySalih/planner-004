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
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  computeAverageSuccessCriteriaScore,
  fetchActivitySuccessCriteriaIds,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria"

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
})

export async function getLatestSubmissionForActivityAction(activityId: string, userId: string) {
  const input = McqSubmissionInputSchema.pick({ activityId: true, userId: true }).parse({
    activityId,
    userId,
  })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("submissions")
    .select("*")
    .eq("activity_id", input.activityId)
    .eq("user_id", input.userId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[submissions] Failed to load submission:", error)
    return SubmissionResultSchema.parse({ data: null, error: error.message })
  }

  if (!data) {
    return SubmissionResultSchema.parse({ data: null, error: null })
  }

  const parsed = SubmissionSchema.safeParse(data)
  if (!parsed.success) {
    console.error("[submissions] Failed to parse submission row:", parsed.error)
    return SubmissionResultSchema.parse({ data: null, error: "Invalid submission data." })
  }

  return SubmissionResultSchema.parse({ data: parsed.data, error: null })
}

export async function readLessonSubmissionSummariesAction(
  lessonId: string,
  options: { userId?: string | null } = {},
): Promise<{ data: LessonSubmissionSummary[]; lessonAverage: number | null; error: string | null }> {
  const trimmedLessonId = lessonId.trim()
  if (!trimmedLessonId) {
    return { data: [], lessonAverage: null, error: null }
  }

  try {
    const viewerUserId = options.userId ?? null
    const supabase = await createSupabaseServerClient()

    const { data: activityRows, error: activitiesError } = await supabase
      .from("activities")
      .select("activity_id, title, type, body_data, active")
      .eq("lesson_id", trimmedLessonId)
      .eq("active", true)

    if (activitiesError) {
      console.error("[submissions] Failed to read lesson activities for feedback summary:", activitiesError)
      return {
        data: [],
        lessonAverage: null,
        error: activitiesError.message ?? "Unable to load activities.",
      }
    }

  const activities = LessonActivitySummaryRowSchema.array().parse(activityRows ?? [])
  if (activities.length === 0) {
    return { data: [], lessonAverage: null, error: null }
  }

  const activityIds = activities.map((activity) => activity.activity_id)

  const activitySuccessCriteriaMap = new Map<string, string[]>()

  if (activityIds.length > 0) {
    const { data: activityCriteriaRows, error: activityCriteriaError } = await supabase
      .from("activity_success_criteria")
      .select("activity_id, success_criteria_id")
      .in("activity_id", activityIds)

    if (activityCriteriaError) {
      console.error("[submissions] Failed to load activity success criteria for summaries:", activityCriteriaError)
    } else {
      for (const row of activityCriteriaRows ?? []) {
        const activityId = typeof row?.activity_id === "string" ? row.activity_id : null
        const successCriteriaId = typeof row?.success_criteria_id === "string" ? row.success_criteria_id : null
        if (!activityId || !successCriteriaId) continue

        const list = activitySuccessCriteriaMap.get(activityId) ?? []
        list.push(successCriteriaId)
        activitySuccessCriteriaMap.set(activityId, list)
      }
    }
  }

    const { data: submissionRows, error: submissionsError } = await supabase
      .from("submissions")
      .select("submission_id, activity_id, user_id, submitted_at, body")
      .in("activity_id", activityIds)

    if (submissionsError) {
      console.error("[submissions] Failed to read lesson submissions for feedback summary:", submissionsError)
      return {
        data: [],
        lessonAverage: null,
        error: submissionsError.message ?? "Unable to load submissions.",
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
  const viewerTotals = { total: 0, count: 0 }

    for (const activity of activities) {
      const activityType = (activity.type ?? "").trim()
      const activityTitle = (activity.title ?? "Untitled activity").trim() || "Untitled activity"
      const submissionList = submissionsByActivity.get(activity.activity_id) ?? []

      if (submissionList.length === 0) {
        continue
      }

      const summary: LessonSubmissionSummary = {
        activityId: activity.activity_id,
        activityTitle,
        activityType,
        totalSubmissions: submissionList.length,
        averageScore: null,
        correctCount: null,
        scores: [],
        correctAnswer: null,
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

        const successCriteriaIds = activitySuccessCriteriaMap.get(activity.activity_id) ?? []

        const scoreEntries = submissionList
          .map((submission) => {
            const parsedSubmission = McqSubmissionBodySchema.safeParse(submission.body)
            if (!parsedSubmission.success) {
              return null
            }
            const isCorrect = parsedSubmission.data.is_correct === true
            const successCriteriaScores = normaliseSuccessCriteriaScores({
              successCriteriaIds,
              existingScores: parsedSubmission.data.success_criteria_scores,
              fillValue: isCorrect ? 1 : 0,
            })
            const score = computeAverageSuccessCriteriaScore(successCriteriaScores) ?? 0
            return {
              userId: submission.user_id,
              score,
              isCorrect,
            }
          })
          .filter((entry): entry is { userId: string; score: number; isCorrect: boolean } => entry !== null)

        summary.scores = scoreEntries
        summary.correctCount = scoreEntries.filter((entry) => entry.isCorrect).length

        if (scoreEntries.length > 0) {
          const totalScore = scoreEntries.reduce((acc, entry) => acc + entry.score, 0)
          summary.averageScore = totalScore / scoreEntries.length
          overallTotals.total += totalScore
          overallTotals.count += scoreEntries.length
          if (viewerUserId) {
            scoreEntries
              .filter((entry) => entry.userId === viewerUserId)
              .forEach((entry) => {
                viewerTotals.total += entry.score
                viewerTotals.count += 1
              })
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

        const successCriteriaIds = activitySuccessCriteriaMap.get(activity.activity_id) ?? []

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
            }
          })
          .filter((entry): entry is { userId: string; score: number; isCorrect: boolean } => entry !== null)

        summary.scores = scoreEntries.map((entry) => ({
          userId: entry.userId,
          score: entry.score,
          isCorrect: entry.isCorrect,
        }))

        summary.correctCount = scoreEntries.filter((entry) => entry.isCorrect).length

        const numericScores = scoreEntries.filter(
          (entry): entry is { userId: string; score: number; isCorrect: boolean } =>
            typeof entry.score === "number" && Number.isFinite(entry.score),
        )

        if (numericScores.length > 0) {
          const totalScore = numericScores.reduce((acc, entry) => acc + entry.score, 0)
          summary.averageScore = totalScore / numericScores.length
          overallTotals.total += totalScore
          overallTotals.count += numericScores.length
          if (viewerUserId) {
            numericScores
              .filter((entry) => entry.userId === viewerUserId)
              .forEach((entry) => {
                viewerTotals.total += entry.score
                viewerTotals.count += 1
              })
          }
        }
      } else {
        const generalScores = submissionList.map((submission) => {
          let score: number | null = null
          const body = submission.body
          if (body && typeof body === "object") {
            const value = (body as Record<string, unknown>).score
            if (typeof value === "number" && Number.isFinite(value)) {
              score = value
            } else if (typeof value === "string") {
              const parsed = Number.parseFloat(value)
              if (!Number.isNaN(parsed)) {
                score = parsed
              }
            }
            if (!summary.correctAnswer) {
              const correctValue = (body as Record<string, unknown>).correctAnswer
              if (typeof correctValue === "string" && correctValue.trim().length > 0) {
                summary.correctAnswer = correctValue.trim()
              }
            }
          }
          return {
            userId: submission.user_id,
            score,
          }
        })

        summary.scores = generalScores

        const numericScores = generalScores.filter((entry) => typeof entry.score === "number") as Array<{
          userId: string
          score: number
        }>

        if (numericScores.length > 0) {
          const totalScore = numericScores.reduce((acc, entry) => acc + entry.score, 0)
          summary.averageScore = totalScore / numericScores.length
          overallTotals.total += totalScore
          overallTotals.count += numericScores.length
          if (viewerUserId) {
            numericScores
              .filter((entry) => entry.userId === viewerUserId)
              .forEach((entry) => {
                viewerTotals.total += entry.score
                viewerTotals.count += 1
              })
          }
        }
      }

      summaries.push(summary)
    }

  const computeAverage = (totals: { total: number; count: number }) =>
    totals.count > 0 ? totals.total / totals.count : null

  const lessonAverage = viewerUserId
    ? computeAverage(viewerTotals)
    : computeAverage(overallTotals)

    return { data: summaries, lessonAverage, error: null }
  } catch (error) {
    console.error("[submissions] Unexpected error building submission summaries:", error)
    return { data: [], lessonAverage: null, error: "Unable to load submission summaries." }
  }
}

export async function upsertMcqSubmissionAction(input: z.infer<typeof McqSubmissionInputSchema>) {
  const payload = McqSubmissionInputSchema.parse(input)
  const supabase = await createSupabaseServerClient()

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select("body_data")
    .eq("activity_id", payload.activityId)
    .maybeSingle()

  if (activityError) {
    console.error("[submissions] Failed to load activity for submission:", activityError)
    return { success: false, error: activityError.message, data: null as Submission | null }
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

  const mcqBody = parsedActivity.data
  const optionExists = mcqBody.options.some((option) => option.id === payload.optionId)

  if (!optionExists) {
    return { success: false, error: "Selected option is no longer available.", data: null as Submission | null }
  }

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(supabase, payload.activityId)
  const isCorrect = mcqBody.correctOptionId === payload.optionId
  const successCriteriaScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: isCorrect ? 1 : 0,
  })

  const submissionBody = McqSubmissionBodySchema.parse({
    answer_chosen: payload.optionId,
    is_correct: isCorrect,
    success_criteria_scores: successCriteriaScores,
  })

  const existing = await supabase
    .from("submissions")
    .select("submission_id")
    .eq("activity_id", payload.activityId)
    .eq("user_id", payload.userId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) {
    console.error("[submissions] Failed to check existing submission:", existing.error)
    return { success: false, error: existing.error.message, data: null as Submission | null }
  }

  const timestamp = new Date().toISOString()

  if (existing.data?.submission_id) {
    const { data, error } = await supabase
      .from("submissions")
      .update({
        body: submissionBody,
        submitted_at: timestamp,
      })
      .eq("submission_id", existing.data.submission_id)
      .select("*")
      .single()

    if (error) {
      console.error("[submissions] Failed to update submission:", error)
      return { success: false, error: error.message, data: null as Submission | null }
    }

    const parsed = SubmissionSchema.safeParse(data)
    if (!parsed.success) {
      console.error("[submissions] Failed to parse updated submission:", parsed.error)
      return { success: false, error: "Invalid submission data.", data: null as Submission | null }
    }

    return { success: true, error: null, data: parsed.data }
  }

  const { data, error } = await supabase
    .from("submissions")
    .insert({
      activity_id: payload.activityId,
      user_id: payload.userId,
      body: submissionBody,
    })
    .select("*")
    .single()

  if (error) {
    console.error("[submissions] Failed to insert submission:", error)
    return { success: false, error: error.message, data: null as Submission | null }
  }

  const parsed = SubmissionSchema.safeParse(data)
  if (!parsed.success) {
    console.error("[submissions] Failed to parse inserted submission:", parsed.error)
    return { success: false, error: "Invalid submission data.", data: null as Submission | null }
  }

  return { success: true, error: null, data: parsed.data }
}
