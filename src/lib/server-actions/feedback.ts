"use server"

import { z } from "zod"

import { FeedbacksSchema, LessonFeedbackSummariesSchema } from "@/types"
import { query } from "@/lib/db"

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

  const groupIds = Array.from(new Set(payload.pairs.map((pair) => pair.groupId)))
  const lessonIds = Array.from(new Set(payload.pairs.map((pair) => pair.lessonId)))

  const membershipRowsAccumulator: unknown[] = []
  const membershipChunkSize = 50
  for (let index = 0; index < groupIds.length; index += membershipChunkSize) {
    const chunk = groupIds.slice(index, index + membershipChunkSize)
    try {
      const { rows } = await query(
        `
          select gm.group_id, gm.user_id, ur.role_id as role
          from group_membership gm
          left join user_roles ur on ur.user_id = gm.user_id
          where gm.group_id = any($1::text[])
        `,
        [chunk],
      )
      membershipRowsAccumulator.push(...(rows ?? []))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load group membership."
      console.error("[feedback] Failed to read group membership for summaries", error)
      return LessonFeedbackSummaryResult.parse({ data: null, error: message })
    }
  }

  const memberships = MembershipRowSchema.array().parse(membershipRowsAccumulator)

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

  const feedbackRowsAccumulator: unknown[] = []
  const lessonChunkSize = 25
  const pupilChunkSize = 50
  const pupilIdList = Array.from(pupilIds)

  for (let lessonIndex = 0; lessonIndex < lessonIds.length; lessonIndex += lessonChunkSize) {
    const lessonChunk = lessonIds.slice(lessonIndex, lessonIndex + lessonChunkSize)
    for (let pupilIndex = 0; pupilIndex < pupilIdList.length; pupilIndex += pupilChunkSize) {
      const pupilChunk = pupilIdList.slice(pupilIndex, pupilIndex + pupilChunkSize)
      try {
        const { rows } = await query(
          `
            select user_id, lesson_id, rating
            from feedback
            where lesson_id = any($1::text[])
              and user_id = any($2::text[])
          `,
          [lessonChunk, pupilChunk],
        )
        feedbackRowsAccumulator.push(...(rows ?? []))
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load feedback entries."
        console.error("[feedback] Failed to read feedback entries for summaries", error)
        return LessonFeedbackSummaryResult.parse({ data: null, error: message })
      }
    }
  }

  const feedbackEntries = FeedbackRowSchema.array().parse(feedbackRowsAccumulator)
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
  let data: unknown[] = []
  try {
    const { rows } = await query("select * from feedback where lesson_id = $1", [lessonId])
    data = rows ?? []
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load feedback."
    console.error("[feedback] Failed to read feedback for lesson", { lessonId, error })
    return FeedbackListReturnValue.parse({ data: null, error: message })
  }

  return FeedbackListReturnValue.parse({ data, error: null })
}

export async function upsertFeedbackAction(input: z.infer<typeof FeedbackMutationInput>) {
  const payload = FeedbackMutationInput.parse(input)

  if (payload.rating === null) {
    try {
      await query(
        `
          delete from feedback
          where user_id = $1
            and lesson_id = $2
            and success_criteria_id = $3
        `,
        [payload.userId, payload.lessonId, payload.successCriteriaId],
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to clear feedback."
      console.error("[feedback] Failed to clear feedback", { payload, error })
      return FeedbackMutationResult.parse({ success: false, error: message })
    }

    return FeedbackMutationResult.parse({ success: true, error: null })
  }

  try {
    await query(
      `
        insert into feedback (user_id, lesson_id, success_criteria_id, rating)
        values ($1, $2, $3, $4)
        on conflict (user_id, lesson_id, success_criteria_id)
        do update set rating = excluded.rating
      `,
      [payload.userId, payload.lessonId, payload.successCriteriaId, payload.rating],
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save feedback."
    console.error("[feedback] Failed to upsert feedback", { payload, error })
    return FeedbackMutationResult.parse({ success: false, error: message })
  }

  return FeedbackMutationResult.parse({ success: true, error: null })
}
