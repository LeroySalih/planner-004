"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonActivitySchema,
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
  SubmissionSchema,
  type Submission,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  scoreShortTextAnswers,
  type ShortTextEvaluationResult,
} from "@/lib/ai/short-text-scoring"
import {
  fetchActivitySuccessCriteriaIds,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/success-criteria"

const ShortTextAnswerInputSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1),
  answer: z.string().optional(),
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
  const supabase = await createSupabaseServerClient()

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(supabase, payload.activityId)
  const initialScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: 0,
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
    console.error("[short-text] Failed to read existing submission:", existing.error)
    return { success: false, error: existing.error.message, data: null as Submission | null }
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
      console.error("[short-text] Failed to update submission:", error)
      return { success: false, error: error.message, data: null as Submission | null }
    }

    const parsed = SubmissionSchema.safeParse(data)
    if (!parsed.success) {
      console.error("[short-text] Invalid submission payload after update:", parsed.error)
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
    console.error("[short-text] Failed to insert submission:", error)
    return { success: false, error: error.message, data: null as Submission | null }
  }

  const parsed = SubmissionSchema.safeParse(data)
  if (!parsed.success) {
    console.error("[short-text] Invalid submission payload after insert:", parsed.error)
    return { success: false, error: "Invalid submission data.", data: null as Submission | null }
  }

  return { success: true, error: null, data: parsed.data }
}

export async function listShortTextSubmissionsAction(activityId: string) {
  const trimmedActivityId = activityId.trim()
  if (!trimmedActivityId) {
    return { success: true, error: null, data: [] as ShortTextSubmissionView[] }
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("submissions")
    .select("submission_id, activity_id, user_id, submitted_at, body")
    .eq("activity_id", trimmedActivityId)

  if (error) {
    console.error("[short-text] Failed to list submissions:", error)
    return { success: false, error: error.message, data: [] as ShortTextSubmissionView[] }
  }

  const parsedRows = ShortTextSubmissionsQuerySchema.array().safeParse(data ?? [])
  if (!parsedRows.success) {
    console.error("[short-text] Failed to parse submissions result:", parsedRows.error)
    return { success: false, error: "Invalid submission data returned.", data: [] as ShortTextSubmissionView[] }
  }

  const userIds = Array.from(
    new Set(parsedRows.data.map((row) => row.user_id).filter((id): id is string => Boolean(id?.trim()))),
  )

  const profilesByUserId = new Map<string, { userId: string; firstName: string | null; lastName: string | null }>()

  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", userIds)

    if (profileError) {
      console.error("[short-text] Failed to load profiles for submissions:", profileError)
    } else {
      (profileRows ?? []).forEach((profile) => {
        if (profile?.user_id) {
          profilesByUserId.set(profile.user_id, {
            userId: profile.user_id,
            firstName: typeof profile.first_name === "string" ? profile.first_name : null,
            lastName: typeof profile.last_name === "string" ? profile.last_name : null,
          })
        }
      })
    }
  }

  const submissions: ShortTextSubmissionView[] = []

  for (const row of parsedRows.data) {
    const parsedBody = ShortTextSubmissionBodySchema.safeParse(row.body ?? {})
    if (!parsedBody.success) {
      console.warn("[short-text] Skipping submission with invalid body:", {
        submissionId: row.submission_id,
        error: parsedBody.error,
      })
      continue
    }

    submissions.push({
      submissionId: row.submission_id,
      activityId: row.activity_id,
      userId: row.user_id,
      submittedAt:
        row.submitted_at instanceof Date
          ? row.submitted_at.toISOString()
          : row.submitted_at ?? null,
      answer: parsedBody.data.answer ?? "",
      aiModelScore: typeof parsedBody.data.ai_model_score === "number" ? parsedBody.data.ai_model_score : null,
      teacherOverrideScore:
        typeof parsedBody.data.teacher_override_score === "number"
          ? parsedBody.data.teacher_override_score
          : null,
      isCorrect: parsedBody.data.is_correct === true,
      profile: profilesByUserId.get(row.user_id) ?? null,
    })
  }

  submissions.sort((a, b) => {
    const aDate = a.submittedAt ?? ""
    const bDate = b.submittedAt ?? ""
    return aDate.localeCompare(bDate)
  })

  return { success: true, error: null, data: submissions }
}

export async function markShortTextActivityAction(input: z.infer<typeof MarkShortTextInputSchema>) {
  const payload = MarkShortTextInputSchema.parse(input)
  const supabase = await createSupabaseServerClient()

  const { data: activityRow, error: activityError } = await supabase
    .from("activities")
    .select("*")
    .eq("activity_id", payload.activityId)
    .maybeSingle()

  if (activityError) {
    console.error("[short-text] Failed to load activity:", activityError)
    return { success: false, error: activityError.message, updated: 0, failed: [] as ShortTextEvaluationResult[] }
  }

  if (!activityRow) {
    return { success: false, error: "Activity not found.", updated: 0, failed: [] as ShortTextEvaluationResult[] }
  }

  const activity = LessonActivitySchema.parse(activityRow)

  const parsedBody = ShortTextActivityBodySchema.safeParse(activity.body_data)
  if (!parsedBody.success) {
    console.error("[short-text] Activity body invalid:", parsedBody.error)
    return {
      success: false,
      error: "Activity is not configured correctly.",
      updated: 0,
      failed: [] as ShortTextEvaluationResult[],
    }
  }

  const question = parsedBody.data.question ?? ""
  const modelAnswer = parsedBody.data.modelAnswer ?? ""

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(supabase, payload.activityId)

  const { data: submissionsResult, error: submissionsError } = await supabase
    .from("submissions")
    .select("submission_id, body")
    .eq("activity_id", payload.activityId)

  if (submissionsError) {
    console.error("[short-text] Failed to load submissions for marking:", submissionsError)
    return { success: false, error: submissionsError.message, updated: 0, failed: [] as ShortTextEvaluationResult[] }
  }

  const parsedSubmissions = submissionsResult ?? []

  if (parsedSubmissions.length === 0) {
    return { success: true, error: null, updated: 0, failed: [] as ShortTextEvaluationResult[] }
  }

  const submissionBodies = parsedSubmissions.map((row) => ({
    submissionId: row.submission_id,
    parsed: ShortTextSubmissionBodySchema.safeParse(row.body ?? {}),
  }))

  const validInputs = submissionBodies
    .filter((entry) => entry.parsed.success)
    .map((entry) => ({
      submissionId: entry.submissionId,
      answer: entry.parsed.success ? entry.parsed.data.answer ?? "" : "",
      existing: entry.parsed.success ? entry.parsed.data : null,
    }))

  if (validInputs.length === 0) {
    return { success: false, error: "No valid submissions to mark.", updated: 0, failed: [] as ShortTextEvaluationResult[] }
  }

  let evaluationResults: ShortTextEvaluationResult[]
  try {
    evaluationResults = await scoreShortTextAnswers(
      question,
      modelAnswer,
      validInputs.map((entry) => ({ submissionId: entry.submissionId, answer: entry.answer })),
    )
  } catch (error) {
    console.error("[short-text] Failed to evaluate submissions:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to evaluate submissions with the AI model.",
      updated: 0,
      failed: [] as ShortTextEvaluationResult[],
    }
  }

  const resultsById = new Map(evaluationResults.map((entry) => [entry.submissionId, entry]))
  const errors: ShortTextEvaluationResult[] = []
  let updatedCount = 0

  for (const entry of validInputs) {
    const evaluation = resultsById.get(entry.submissionId)
    if (!evaluation || typeof evaluation.score !== "number") {
      errors.push(evaluation ?? { submissionId: entry.submissionId, score: null, error: "Missing evaluation." })
      continue
    }

    const currentBody = entry.existing ?? {
      answer: entry.answer,
      ai_model_score: null,
      ai_model_feedback: null,
      teacher_override_score: null,
      is_correct: false,
    }

    const teacherOverride = typeof currentBody.teacher_override_score === "number" ? currentBody.teacher_override_score : null
    const aiScore = evaluation.score

    const isCorrect = computeIsCorrect(teacherOverride ?? aiScore)
    const effectiveScore =
      typeof teacherOverride === "number" && Number.isFinite(teacherOverride) ? teacherOverride : aiScore ?? 0

    const successCriteriaScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: effectiveScore ?? 0,
    })

    const submissionBody = ShortTextSubmissionBodySchema.parse({
      answer: currentBody.answer ?? entry.answer,
      ai_model_score: aiScore,
      ai_model_feedback: currentBody.ai_model_feedback ?? null,
      teacher_override_score: teacherOverride,
      is_correct: isCorrect,
      success_criteria_scores: successCriteriaScores,
    })

    const { error } = await supabase
      .from("submissions")
      .update({ body: submissionBody })
      .eq("submission_id", entry.submissionId)

    if (error) {
      console.error("[short-text] Failed to update submission with AI score:", error)
      errors.push({ submissionId: entry.submissionId, score: null, error: error.message })
      continue
    }

    updatedCount += 1
  }

  if (payload.lessonId) {
    revalidatePath(`/lessons/${payload.lessonId}`)
  }

  return { success: errors.length === 0, error: errors.length > 0 ? "Some submissions could not be updated." : null, updated: updatedCount, failed: errors }
}

export async function overrideShortTextSubmissionScoreAction(
  input: z.infer<typeof OverrideShortTextScoreSchema>,
) {
  const payload = OverrideShortTextScoreSchema.parse(input)
  const supabase = await createSupabaseServerClient()

  const { data: submissionRow, error: submissionError } = await supabase
    .from("submissions")
    .select("*")
    .eq("submission_id", payload.submissionId)
    .eq("activity_id", payload.activityId)
    .maybeSingle()

  if (submissionError) {
    console.error("[short-text] Failed to load submission for override:", submissionError)
    return { success: false, error: submissionError.message, data: null as Submission | null }
  }

  if (!submissionRow) {
    return { success: false, error: "Submission not found.", data: null as Submission | null }
  }

  const parsedSubmission = SubmissionSchema.safeParse(submissionRow)
  if (!parsedSubmission.success) {
    console.error("[short-text] Invalid submission row for override:", parsedSubmission.error)
    return { success: false, error: "Invalid submission data.", data: null as Submission | null }
  }

  const currentBody = ShortTextSubmissionBodySchema.safeParse(parsedSubmission.data.body ?? {})
  if (!currentBody.success) {
    console.error("[short-text] Invalid submission body for override:", currentBody.error)
    return { success: false, error: "Submission data is malformed.", data: null as Submission | null }
  }

  const overrideScore =
    typeof payload.overrideScore === "number" && Number.isFinite(payload.overrideScore)
      ? payload.overrideScore
      : null

  const aiScore =
    typeof currentBody.data.ai_model_score === "number" && Number.isFinite(currentBody.data.ai_model_score)
      ? currentBody.data.ai_model_score
      : null

  const effectiveScore = overrideScore ?? aiScore ?? 0
  const isCorrect = computeIsCorrect(effectiveScore)

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(supabase, payload.activityId)
  const successCriteriaScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: effectiveScore,
  })

  const submissionBody = ShortTextSubmissionBodySchema.parse({
    answer: currentBody.data.answer ?? "",
    ai_model_score: aiScore,
    ai_model_feedback: currentBody.data.ai_model_feedback ?? null,
    teacher_override_score: overrideScore,
    is_correct: isCorrect,
    success_criteria_scores: successCriteriaScores,
  })

  const { data, error } = await supabase
    .from("submissions")
    .update({ body: submissionBody })
    .eq("submission_id", payload.submissionId)
    .select("*")
    .single()

  if (error) {
    console.error("[short-text] Failed to apply score override:", error)
    return { success: false, error: error.message, data: null as Submission | null }
  }

  if (payload.lessonId) {
    revalidatePath(`/lessons/${payload.lessonId}`)
  }

  const parsed = SubmissionSchema.safeParse(data)
  if (!parsed.success) {
    console.error("[short-text] Invalid submission returned after override:", parsed.error)
    return { success: false, error: "Invalid submission data.", data: null as Submission | null }
  }

  return { success: true, error: null, data: parsed.data }
}

function computeIsCorrect(score: number | null): boolean {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return false
  }
  return score >= SHORT_TEXT_CORRECTNESS_THRESHOLD
}
