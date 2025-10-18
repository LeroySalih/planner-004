"use server"

import { z } from "zod"

import {
  LessonAssignmentScoreSummariesSchema,
  SubmissionSchema,
  type LessonAssignmentScoreSummaries,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireTeacherProfile } from "@/lib/auth"
import { computeAverageSuccessCriteriaScore } from "@/lib/scoring/success-criteria"
import { extractScoreFromSubmission, selectLatestSubmission } from "@/lib/scoring/activity-scores"
import { isScorableActivityType } from "@/dino.config"

const LessonAssignmentScoreSummaryInputSchema = z.object({
  pairs: z
    .array(
      z.object({
        groupId: z.string().min(1),
        lessonId: z.string().min(1),
      }),
    )
    .max(500),
})

const LessonAssignmentScoreSummaryResultSchema = z.object({
  data: LessonAssignmentScoreSummariesSchema.nullable(),
  error: z.string().nullable(),
})

const MembershipRowSchema = z.object({
  group_id: z.string(),
  user_id: z.string(),
  role: z.string(),
})

const ActivityRowSchema = z.object({
  activity_id: z.string(),
  lesson_id: z.string(),
  type: z.string().nullable().optional(),
  is_summative: z.boolean().nullable().optional(),
})

const ActivitySuccessCriterionRowSchema = z.object({
  activity_id: z.string(),
  success_criteria_id: z.string(),
})

type ParsedSubmission = z.infer<typeof SubmissionSchema>

export async function readLessonAssignmentScoreSummariesAction(
  input: z.infer<typeof LessonAssignmentScoreSummaryInputSchema>,
) {
  await requireTeacherProfile()

  const payload = LessonAssignmentScoreSummaryInputSchema.parse(input)

  if (payload.pairs.length === 0) {
    return LessonAssignmentScoreSummaryResultSchema.parse({ data: [], error: null })
  }

  const uniquePairsMap = new Map<string, { groupId: string; lessonId: string }>()
  for (const pair of payload.pairs) {
    const key = `${pair.groupId}::${pair.lessonId}`
    if (!uniquePairsMap.has(key)) {
      uniquePairsMap.set(key, pair)
    }
  }
  const pairs = Array.from(uniquePairsMap.values())

  const groupIds = Array.from(new Set(pairs.map((pair) => pair.groupId)))
  const lessonIds = Array.from(new Set(pairs.map((pair) => pair.lessonId)))

  const supabase = await createSupabaseServerClient()

  const membershipRowsAccumulator: unknown[] = []
  const membershipChunkSize = 50
  for (let index = 0; index < groupIds.length; index += membershipChunkSize) {
    const chunk = groupIds.slice(index, index + membershipChunkSize)
    const { data: membershipRows, error: membershipError } = await supabase
      .from("group_membership")
      .select("group_id, user_id, role")
      .in("group_id", chunk)

    if (membershipError) {
      console.error("[lesson-assignment-scores] Failed to load group membership", membershipError)
      return LessonAssignmentScoreSummaryResultSchema.parse({
        data: null,
        error: membershipError.message ?? "Unable to load group membership.",
      })
    }

    membershipRowsAccumulator.push(...(membershipRows ?? []))
  }

  const memberships = MembershipRowSchema.array().parse(membershipRowsAccumulator)

  const pupilsByGroup = new Map<string, string[]>()
  const pooledPupilIds = new Set<string>()
  memberships.forEach((membership) => {
    if (membership.role.trim().toLowerCase() !== "pupil") {
      return
    }
    const list = pupilsByGroup.get(membership.group_id) ?? []
    list.push(membership.user_id)
    pupilsByGroup.set(membership.group_id, list)
    pooledPupilIds.add(membership.user_id)
  })

  const { data: activityRows, error: activitiesError } = await supabase
    .from("activities")
    .select("activity_id, lesson_id, type, is_summative, active")
    .in("lesson_id", lessonIds)
    .eq("active", true)

  if (activitiesError) {
    console.error("[lesson-assignment-scores] Failed to load lesson activities", activitiesError)
    return LessonAssignmentScoreSummaryResultSchema.parse({
      data: null,
      error: activitiesError.message ?? "Unable to load lesson activities.",
    })
  }

  const activityRecords = ActivityRowSchema.array().parse(activityRows ?? [])
  const scorableActivities = activityRecords.filter((activity) => isScorableActivityType(activity.type))

  const activitiesByLesson = new Map<
    string,
    Array<{
      activityId: string
      type: string
      successCriteriaIds: string[]
    }>
  >()
  const activityIds: string[] = []

  scorableActivities.forEach((activity) => {
    activityIds.push(activity.activity_id)
    const list = activitiesByLesson.get(activity.lesson_id) ?? []
    list.push({
      activityId: activity.activity_id,
      type: (activity.type ?? "").trim(),
      successCriteriaIds: [],
    })
    activitiesByLesson.set(activity.lesson_id, list)
  })

  const successCriteriaByActivity = new Map<string, string[]>()
  if (activityIds.length > 0) {
    const { data: criteriaRows, error: criteriaError } = await supabase
      .from("activity_success_criteria")
      .select("activity_id, success_criteria_id")
      .in("activity_id", activityIds)

    if (criteriaError) {
      console.error("[lesson-assignment-scores] Failed to load activity success criteria", criteriaError)
      return LessonAssignmentScoreSummaryResultSchema.parse({
        data: null,
        error: criteriaError.message ?? "Unable to load activity criteria.",
      })
    }

    const parsedCriteriaRows = ActivitySuccessCriterionRowSchema.array().parse(criteriaRows ?? [])
    parsedCriteriaRows.forEach((row) => {
      const existing = successCriteriaByActivity.get(row.activity_id) ?? []
      existing.push(row.success_criteria_id)
      successCriteriaByActivity.set(row.activity_id, existing)
    })
  }

  // Attach success criteria lists to activity entries
  activitiesByLesson.forEach((activityList) => {
    activityList.forEach((entry) => {
      entry.successCriteriaIds = successCriteriaByActivity.get(entry.activityId) ?? []
    })
  })

  const latestSubmissions = new Map<
    string,
    {
      submission: ParsedSubmission
      submittedAt: string | null
    }
  >()

  if (activityIds.length > 0 && pooledPupilIds.size > 0) {
    const submissionActivityChunkSize = 50
    const submissionPupilChunkSize = 100
    const pupilIdList = Array.from(pooledPupilIds)

    for (let activityIndex = 0; activityIndex < activityIds.length; activityIndex += submissionActivityChunkSize) {
      const activityChunk = activityIds.slice(activityIndex, activityIndex + submissionActivityChunkSize)

      for (let pupilIndex = 0; pupilIndex < pupilIdList.length; pupilIndex += submissionPupilChunkSize) {
        const pupilChunk = pupilIdList.slice(pupilIndex, pupilIndex + submissionPupilChunkSize)

        const { data: submissionRows, error: submissionsError } = await supabase
          .from("submissions")
          .select("submission_id, activity_id, user_id, submitted_at, body")
          .in("activity_id", activityChunk)
          .in("user_id", pupilChunk)

        if (submissionsError) {
          console.error("[lesson-assignment-scores] Failed to load submissions", submissionsError)
          return LessonAssignmentScoreSummaryResultSchema.parse({
            data: null,
            error: submissionsError.message ?? "Unable to load submissions.",
          })
        }

        const parsedSubmissions = SubmissionSchema.array().parse(submissionRows ?? [])

        parsedSubmissions.forEach((submission) => {
          const key = `${submission.activity_id}::${submission.user_id}`
          const submittedAt = typeof submission.submitted_at === "string" ? submission.submitted_at : null
          const existing = latestSubmissions.get(key)

          if (!existing || selectLatestSubmission({ submittedAt: existing.submittedAt }, submittedAt)) {
            latestSubmissions.set(key, { submission, submittedAt })
          }
        })
      }
    }
  }

  const summaries: LessonAssignmentScoreSummaries = []

  pairs.forEach(({ groupId, lessonId }) => {
    const pupils = pupilsByGroup.get(groupId) ?? []
    const activities = activitiesByLesson.get(lessonId) ?? []

    if (pupils.length === 0 || activities.length === 0) {
      summaries.push({
        group_id: groupId,
        lesson_id: lessonId,
        activities_average: null,
      })
      return
    }

    let totalScore = 0
    let cellCount = 0
    let hasSubmission = false

    activities.forEach((activity) => {
      const successCriteriaIds = activity.successCriteriaIds
      const activityType = activity.type

      pupils.forEach((pupilId) => {
        cellCount += 1
        const submissionEntry = latestSubmissions.get(`${activity.activityId}::${pupilId}`)
        if (submissionEntry) {
          hasSubmission = true
          const extracted = extractScoreFromSubmission(
            activityType,
            submissionEntry.submission.body,
            successCriteriaIds,
            {
              question: null,
              correctAnswer: null,
            },
          )
          const finalScore =
            computeAverageSuccessCriteriaScore(extracted.successCriteriaScores) ??
            extracted.effectiveScore ??
            0
          const numericScore =
            typeof finalScore === "number" && Number.isFinite(finalScore) ? finalScore : 0
          totalScore += numericScore
        } else {
          totalScore += 0
        }
      })
    })

    let activitiesAverage: number | null = null
    if (hasSubmission && cellCount > 0) {
      const rawAverage = totalScore / cellCount
      activitiesAverage = Math.min(1, Math.max(0, rawAverage))
    }

    summaries.push({
      group_id: groupId,
      lesson_id: lessonId,
      activities_average: activitiesAverage,
    })
  })

  return LessonAssignmentScoreSummaryResultSchema.parse({
    data: LessonAssignmentScoreSummariesSchema.parse(summaries),
    error: null,
  })
}
