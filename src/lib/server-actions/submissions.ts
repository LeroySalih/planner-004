"use server"

import { z } from "zod"

import {
  McqActivityBodySchema,
  McqSubmissionBodySchema,
  SubmissionSchema,
  type Submission,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const SubmissionResultSchema = z.object({
  data: SubmissionSchema.nullable(),
  error: z.string().nullable(),
})

const McqSubmissionInputSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1),
  optionId: z.string().min(1),
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

  const submissionBody = McqSubmissionBodySchema.parse({
    answer_chosen: payload.optionId,
    is_correct: mcqBody.correctOptionId === payload.optionId,
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
