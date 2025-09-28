"use server"

import { z } from "zod"

import { FeedbacksSchema } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const FeedbackListReturnValue = z.object({
  data: FeedbacksSchema.nullable(),
  error: z.string().nullable(),
})

const FeedbackMutationInput = z.object({
  userId: z.string().min(1),
  lessonId: z.string().min(1),
  successCriteriaId: z.string().min(1),
  rating: z.number().int().min(-1).max(1).nullable(),
})

const FeedbackMutationResult = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
})

export async function readFeedbackForLessonAction(lessonId: string) {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("feedback")
    .select("*")
    .eq("lesson_id", lessonId)

  if (error) {
    console.error("[feedback] Failed to read feedback for lesson", { lessonId, error })
    return FeedbackListReturnValue.parse({ data: null, error: error.message })
  }

  return FeedbackListReturnValue.parse({ data, error: null })
}

export async function upsertFeedbackAction(input: z.infer<typeof FeedbackMutationInput>) {
  const payload = FeedbackMutationInput.parse(input)

  if (payload.rating === null) {
    const supabase = await createSupabaseServerClient()

    const { error } = await supabase
      .from("feedback")
      .delete()
      .eq("user_id", payload.userId)
      .eq("lesson_id", payload.lessonId)
      .eq("success_criteria_id", payload.successCriteriaId)

    if (error) {
      console.error("[feedback] Failed to clear feedback", { payload, error })
      return FeedbackMutationResult.parse({ success: false, error: error.message })
    }

    return FeedbackMutationResult.parse({ success: true, error: null })
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("feedback")
    .upsert(
      {
        user_id: payload.userId,
        lesson_id: payload.lessonId,
        success_criteria_id: payload.successCriteriaId,
        rating: payload.rating,
      },
      { onConflict: "user_id,lesson_id,success_criteria_id" },
    )

  if (error) {
    console.error("[feedback] Failed to upsert feedback", { payload, error })
    return FeedbackMutationResult.parse({ success: false, error: error.message })
  }

  return FeedbackMutationResult.parse({ success: true, error: null })
}
