import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  ShortTextFeedbackEventSchema,
  ShortTextFeedbackRequestSchema,
  ShortTextFeedbackResultSchema,
  type ShortTextFeedbackRequest,
  type ShortTextFeedbackResult,
} from "@/types"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { scoreShortTextAnswers } from "@/lib/ai/short-text-scoring"

const HYDRATE_RPC = "get_latest_short_text_submission"

const LatestShortTextSubmissionSchema = z
  .object({
    submission_id: z.string().nullish(),
    activity_id: z.string().nullish(),
    lesson_id: z.string().nullish(),
    activity_question: z.string().nullish(),
    activity_model_answer: z.string().nullish(),
    pupil_answer: z.string().nullish(),
  })
  .nullable()

type LatestShortTextSubmission = z.infer<typeof LatestShortTextSubmissionSchema>

export async function generateShortTextFeedback(
  input: ShortTextFeedbackRequest,
): Promise<ShortTextFeedbackResult> {
  const payload = ShortTextFeedbackRequestSchema.parse(input)
  const supabase = createSupabaseServiceClient()

  const latest = await loadLatestSubmission(payload.activity_id, payload.pupil_id, supabase)

  const finalQuestion = (payload.activity_question ?? latest?.activity_question ?? "").trim()
  const finalModelAnswer = (payload.activity_model_answer ?? latest?.activity_model_answer ?? "").trim()
  const finalPupilAnswer = payload.pupil_answer ?? latest?.pupil_answer ?? ""
  const finalLessonId = payload.lesson_id ?? latest?.lesson_id ?? null
  const resolvedSubmissionId = payload.submission_id ?? latest?.submission_id ?? null

  const populatedFromSubmission =
    (!payload.activity_question && Boolean(latest?.activity_question)) ||
    (!payload.activity_model_answer && Boolean(latest?.activity_model_answer)) ||
    (!payload.pupil_answer && Boolean(latest?.pupil_answer))

  if (!finalQuestion || !finalModelAnswer) {
    throw new Error("activity_question and activity_model_answer are required to score submissions.")
  }

  const scoringSubmissionId = resolvedSubmissionId ?? randomUUID()
  const evaluation = await scoreShortTextAnswers(finalQuestion, finalModelAnswer, [
    { submissionId: scoringSubmissionId, answer: finalPupilAnswer ?? "" },
  ])
  const evaluationResult = evaluation.find((entry) => entry.submissionId === scoringSubmissionId) ?? null
  const score = typeof evaluationResult?.score === "number" ? clampScore(evaluationResult.score) : null

  if (score === null) {
    throw new Error(evaluationResult?.error ?? "Unable to score short-text submission.")
  }

  const feedbackMessage = buildFeedbackMessage(score, finalQuestion, finalModelAnswer, finalPupilAnswer ?? "")

  const { data: inserted, error: insertError } = await supabase
    .from("short_text_feedback_events")
    .insert({
      assignment_id: payload.assignment_id,
      lesson_id: finalLessonId,
      activity_id: payload.activity_id,
      submission_id: resolvedSubmissionId,
      pupil_id: payload.pupil_id,
      activity_question: finalQuestion,
      activity_model_answer: finalModelAnswer,
      pupil_answer: finalPupilAnswer ?? "",
      ai_score: score,
      ai_feedback: feedbackMessage,
      request_context: payload.request_context ?? null,
    })
    .select("*")
    .single()

  if (insertError) {
    console.error("[mcp-feedback] Failed to persist short text feedback event:", insertError)
    throw new Error("Unable to persist short-text feedback event.")
  }

  const parsedEvent = ShortTextFeedbackEventSchema.safeParse(inserted)
  if (!parsedEvent.success) {
    console.error("[mcp-feedback] Invalid feedback event payload:", parsedEvent.error)
    throw new Error("Short-text feedback event payload was invalid.")
  }

  return ShortTextFeedbackResultSchema.parse({
    assignment_id: payload.assignment_id,
    pupil_id: payload.pupil_id,
    activity_id: payload.activity_id,
    activity_question: finalQuestion,
    activity_model_answer: finalModelAnswer,
    pupil_answer: finalPupilAnswer ?? "",
    score,
    feedback: feedbackMessage,
    populated_from_submission: populatedFromSubmission,
  })
}

async function loadLatestSubmission(
  activityId: string,
  pupilId: string,
  supabase = createSupabaseServiceClient(),
): Promise<LatestShortTextSubmission> {
  const { data, error } = await supabase.rpc(HYDRATE_RPC, {
    p_activity_id: activityId,
    p_pupil_id: pupilId,
  })

  if (error) {
    console.error("[mcp-feedback] Failed to load latest short-text submission:", error)
    throw new Error("Unable to load latest short-text submission.")
  }

  if (!data) {
    return null
  }

  const firstRow = Array.isArray(data) ? data[0] ?? null : data
  const parsed = LatestShortTextSubmissionSchema.safeParse(firstRow)
  if (!parsed.success) {
    console.error("[mcp-feedback] Latest submission RPC returned invalid payload:", parsed.error)
    throw new Error("Unable to parse short-text submission data.")
  }

  return parsed.data
}

function buildFeedbackMessage(score: number, question: string, modelAnswer: string, pupilAnswer: string) {
  const normalizedAnswer = (pupilAnswer ?? "").trim()
  if (!normalizedAnswer) {
    return "Try answering the question so I can compare it to the model response."
  }
  if (score >= 0.85) {
    return "Great job—your answer matches the key points from the model response."
  }
  if (score >= 0.6) {
    return `You're close. Compare your answer to the model answer: ${modelAnswer}. Add the missing detail to reach full marks.`
  }
  return `Revisit the question: ${question}. Use the model answer as a guide and explain the same ideas in your own words.`
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value))
}
