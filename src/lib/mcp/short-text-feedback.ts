import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  ShortTextFeedbackEventSchema,
  ShortTextFeedbackRequestSchema,
  ShortTextFeedbackResultSchema,
  type ShortTextFeedbackRequest,
  type ShortTextFeedbackResult,
} from "@/types"
import { query } from "@/lib/db"
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
  const latest = await loadLatestSubmission(payload.activity_id, payload.pupil_id)

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

  const { rows: insertedRows } = await query(
    `
      insert into short_text_feedback_events (
        assignment_id,
        lesson_id,
        activity_id,
        submission_id,
        pupil_id,
        activity_question,
        activity_model_answer,
        pupil_answer,
        ai_score,
        ai_feedback,
        request_context
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      returning *
    `,
    [
      payload.assignment_id,
      finalLessonId,
      payload.activity_id,
      resolvedSubmissionId,
      payload.pupil_id,
      finalQuestion,
      finalModelAnswer,
      finalPupilAnswer ?? "",
      score,
      feedbackMessage,
      payload.request_context ?? null,
    ],
  )

  const inserted = insertedRows?.[0] ?? null
  if (!inserted) {
    console.error("[mcp-feedback] Failed to persist short text feedback event: empty result")
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

async function loadLatestSubmission(activityId: string, pupilId: string): Promise<LatestShortTextSubmission> {
  try {
    const { rows } = await query(
      "select get_latest_short_text_submission($1, $2) as payload",
      [activityId, pupilId],
    )

    const data = rows?.[0]?.payload ?? null
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
  } catch (error) {
    console.error("[mcp-feedback] Failed to load latest short-text submission:", error)
    throw new Error("Unable to load latest short-text submission.")
  }
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
