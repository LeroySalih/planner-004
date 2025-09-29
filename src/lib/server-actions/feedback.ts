"use server"

import { z } from "zod"

import { FeedbacksSchema, LessonFeedbackSummariesSchema } from "@/types"
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

const LessonFeedbackSummaryInput = z.object({
  pairs: z
    .array(
      z.object({
        groupId: z.string().min(1),
        lessonId: z.string().min(1),
      }),
    )
    .max(1000),
})

const LessonFeedbackSummaryResult = z.object({
  data: LessonFeedbackSummariesSchema.nullable(),
  error: z.string().nullable(),
})

const MembershipRowSchema = z.object({
  group_id: z.string(),
  user_id: z.string(),
  role: z.string(),
})

const FeedbackRowSchema = z.object({
  user_id: z.string(),
  lesson_id: z.string(),
  rating: z.number().int(),
})

export async function readLessonFeedbackSummariesAction(
  input: z.infer<typeof LessonFeedbackSummaryInput>,
) {
  const payload = LessonFeedbackSummaryInput.parse(input)

  if (payload.pairs.length === 0) {
    return LessonFeedbackSummaryResult.parse({ data: [], error: null })
  }

  const supabase = await createSupabaseServerClient()

  const groupIds = Array.from(new Set(payload.pairs.map((pair) => pair.groupId)))
  const lessonIds = Array.from(new Set(payload.pairs.map((pair) => pair.lessonId)))

  const { data: membershipRows, error: membershipError } = await supabase
    .from("group_membership")
    .select("group_id, user_id, role")
    .in("group_id", groupIds)

  if (membershipError) {
    console.error("[feedback] Failed to read group membership for summaries", membershipError)
    return LessonFeedbackSummaryResult.parse({ data: null, error: membershipError.message })
  }

  const memberships = MembershipRowSchema.array().parse(membershipRows ?? [])

  const pupilMemberships = memberships.filter((row) => row.role.trim().toLowerCase() === "pupil")
  const pupilsByGroup = new Map<string, string[]>()
  const pupilIds = new Set<string>()

  for (const row of pupilMemberships) {
    const existing = pupilsByGroup.get(row.group_id) ?? []
    existing.push(row.user_id)
    pupilsByGroup.set(row.group_id, existing)
    pupilIds.add(row.user_id)
  }

  if (pupilIds.size === 0) {
    const emptySummaries = payload.pairs.map((pair) => ({
      group_id: pair.groupId,
      lesson_id: pair.lessonId,
      total_pupils: 0,
      positive_count: 0,
      negative_count: 0,
      unmarked_count: 0,
    }))
    return LessonFeedbackSummaryResult.parse({ data: emptySummaries, error: null })
  }

  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("feedback")
    .select("user_id, lesson_id, rating")
    .in("lesson_id", lessonIds)
    .in("user_id", Array.from(pupilIds))

  if (feedbackError) {
    console.error("[feedback] Failed to read feedback entries for summaries", feedbackError)
    return LessonFeedbackSummaryResult.parse({ data: null, error: feedbackError.message })
  }

  const feedbackEntries = FeedbackRowSchema.array().parse(feedbackRows ?? [])
  const feedbackByLessonAndUser = new Map<string, number[]>()
  for (const entry of feedbackEntries) {
    const key = `${entry.lesson_id}::${entry.user_id}`
    const existing = feedbackByLessonAndUser.get(key) ?? []
    existing.push(entry.rating)
    feedbackByLessonAndUser.set(key, existing)
  }

  const summaries = payload.pairs.map((pair) => {
    const pupils = pupilsByGroup.get(pair.groupId) ?? []
    const totalPupils = pupils.length

    if (totalPupils === 0) {
      return {
        group_id: pair.groupId,
        lesson_id: pair.lessonId,
        total_pupils: 0,
        positive_count: 0,
        negative_count: 0,
        unmarked_count: 0,
      }
    }

    let positiveCount = 0
    let negativeCount = 0
    let unmarkedCount = 0

    for (const pupilId of pupils) {
      const ratings = feedbackByLessonAndUser.get(`${pair.lessonId}::${pupilId}`) ?? []
      const hasNegative = ratings.some((rating) => rating < 0)
      const hasPositive = ratings.some((rating) => rating > 0)

      if (hasNegative) {
        negativeCount += 1
      } else if (hasPositive) {
        positiveCount += 1
      } else {
        unmarkedCount += 1
      }
    }

    return {
      group_id: pair.groupId,
      lesson_id: pair.lessonId,
      total_pupils: totalPupils,
      positive_count: positiveCount,
      negative_count: negativeCount,
      unmarked_count: unmarkedCount,
    }
  })

  return LessonFeedbackSummaryResult.parse({ data: summaries, error: null })
}

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
