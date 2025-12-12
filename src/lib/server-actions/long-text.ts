"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LongTextSubmissionBodySchema,
  SubmissionSchema,
  type Submission,
} from "@/types"
import { fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"
import { query } from "@/lib/db"

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
    console.error("[long-text] Failed to read existing submission:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to save submission.",
      data: null as Submission | null,
    }
  }

  const submissionBody = LongTextSubmissionBodySchema.parse({
    answer: (payload.answer ?? "").trim(),
    success_criteria_scores: initialScores,
  })

  const timestamp = new Date().toISOString()

  try {
    if (existingId) {
      const { rows } = await query(
        `
          update submissions
          set body = $1, submitted_at = $2
          where submission_id = $3
          returning *
        `,
        [submissionBody, timestamp, existingId],
      )
      const parsed = SubmissionSchema.safeParse(rows[0])
      if (!parsed.success) {
        console.error("[long-text] Invalid submission payload after update:", parsed.error)
        return { success: false, error: "Invalid submission data.", data: null as Submission | null }
      }
      revalidatePath(`/lessons/${payload.activityId}`)
      return { success: true, error: null, data: parsed.data }
    }

    const { rows } = await query(
      `
        insert into submissions (activity_id, user_id, body, submitted_at, submission_status)
        values ($1, $2, $3, $4, 'inprogress')
        returning *
      `,
      [payload.activityId, payload.userId, submissionBody, timestamp],
    )

    const parsed = SubmissionSchema.safeParse(rows[0])
    if (!parsed.success) {
      console.error("[long-text] Invalid submission payload after insert:", parsed.error)
      return { success: false, error: "Invalid submission data.", data: null as Submission | null }
    }

    revalidatePath(`/lessons/${payload.activityId}`)
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
