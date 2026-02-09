import { z } from "zod"

import {
  AssignmentsWithUnitSchema,
  FeedbacksSchema,
  GroupMembershipsWithGroupSchema,
  LearningObjectiveWithCriteriaSchema,
  LessonActivitiesSchema,
  LessonSuccessCriteriaSchema,
  LessonWithObjectivesSchema,
  McqActivityBodySchema,
  McqSubmissionBodySchema,
  ProfileSchema,
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
  SubmissionsSchema,
  type LearningObjectiveWithCriteria,
  type LessonActivity,
  type LessonSubmissionSummary,
  type LessonWithObjectives,
  type Submission,
} from "@/types"
import { getLevelForYearScore } from "@/lib/levels"
import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"
import { computeAverageSuccessCriteriaScore, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"
import { isScorableActivityType } from "@/dino.config"

export const ReportDatasetLessonSchema = LessonWithObjectivesSchema.extend({
  activities: LessonActivitiesSchema.default([]),
  submissions: SubmissionsSchema.default([]),
  lesson_success_criteria: LessonSuccessCriteriaSchema.default([]),
})

export const ReportDatasetUnitSchema = z.object({
  unit_id: z.string(),
  learning_objectives: z.array(LearningObjectiveWithCriteriaSchema).default([]),
  lessons: z.array(ReportDatasetLessonSchema).default([]),
})

export const ReportDatasetSchema = z.object({
  profile: ProfileSchema.nullable().optional().default(null),
  memberships: GroupMembershipsWithGroupSchema.default([]),
  assignments: AssignmentsWithUnitSchema.default([]),
  feedback: FeedbacksSchema.default([]),
  units: z.array(ReportDatasetUnitSchema).default([]),
})

export type ReportDataset = z.infer<typeof ReportDatasetSchema>
export type ReportMembership = z.infer<typeof GroupMembershipsWithGroupSchema>[number]
export type ReportAssignment = z.infer<typeof AssignmentsWithUnitSchema>[number]

async function fetchReportDataset(
  pupilId: string,
  groupIdFilter?: string | null,
): Promise<ReportDataset> {
  try {
    // Call the SQL function directly to build dataset on-the-fly (no cache)
    const { rows } = await query(
      "select reports_get_prepared_report_dataset($1, $2) as dataset",
      [pupilId, groupIdFilter || null],
    )
    const datasetPayload = rows?.[0]?.dataset ?? {}

    return ReportDatasetSchema.parse(datasetPayload)
  } catch (error) {
    console.error("[reports] Failed to load dataset via PG", { pupilId, error })
    throw new Error(error instanceof Error ? error.message : "Failed to load report dataset.")
  }
}

async function fetchLatestFeedbackSnapshot(
  pupilId: string,
): Promise<Record<string, number>> {
  try {
    // Query latest feedback directly from feedback table (no cache)
    const { rows } = await query(
      `SELECT DISTINCT ON (success_criteria_id)
         success_criteria_id,
         rating
       FROM feedback
       WHERE user_id = $1
       ORDER BY success_criteria_id, id DESC`,
      [pupilId],
    )
    const snapshot: Record<string, number> = {}
    for (const entry of rows ?? []) {
      const criterionId =
        typeof entry.success_criteria_id === "string" ? entry.success_criteria_id.trim() : ""
      if (!criterionId) continue
      if (typeof entry.rating === "number") {
        snapshot[criterionId] = entry.rating
      }
    }
    return snapshot
  } catch (error) {
    console.error("[reports] Failed to read feedback via PG", { pupilId, error })
    return {}
  }
}

async function readCachedUnitSummaries(
  pupilId: string,
  options?: { groupIdFilter?: string },
): Promise<ReportUnitSummary[]> {
  // Cache tables removed - always build summaries from dataset
  // This function now returns empty array to trigger fallback to buildDatasetUnitSummaries
  return []
}

export function buildFeedbackMapFromDataset(entries: ReportDataset["feedback"]) {
  const latestFeedbackByCriterion = new Map<string, { rating: number; id: number }>()
  for (const entry of entries) {
    const existing = latestFeedbackByCriterion.get(entry.success_criteria_id)
    if (!existing || entry.id > existing.id) {
      latestFeedbackByCriterion.set(entry.success_criteria_id, {
        rating: entry.rating,
        id: entry.id,
      })
    }
  }

  const feedbackByCriterion: Record<string, number> = {}
  latestFeedbackByCriterion.forEach((value, key) => {
    feedbackByCriterion[key] = value.rating
  })
  return feedbackByCriterion
}

export type ReportCriterionRow = {
  level: number | null
  assessmentObjectiveCode: string | null
  assessmentObjectiveTitle: string | null
  objectiveTitle: string
  learningObjectiveId: string | null
  criterionId: string
  criterionDescription: string | null
  activitiesScore: number | null
  assessmentScore: number | null
}

export type ReportUnitSummary = {
  unitId: string
  unitTitle: string
  unitSubject: string | null
  unitDescription: string | null
  unitYear: number | null
  relatedGroups: string[]
  objectiveError: string | null | undefined
  groupedLevels: Array<{
    level: number
    rows: ReportCriterionRow[]
  }>
  workingLevel: number | null
  activitiesAverage: number | null
  assessmentAverage: number | null
  assessmentLevel: string | null
  scoreError: string | null
}

export type ReportSubjectEntry = {
  subject: string
  workingLevel: number | null
  units: ReportUnitSummary[]
}

const ReportCriterionRowSchema = z.object({
  level: z.number().nullable(),
  assessmentObjectiveCode: z.string().nullable(),
  assessmentObjectiveTitle: z.string().nullable(),
  objectiveTitle: z.string(),
  learningObjectiveId: z.string().nullable(),
  criterionId: z.string(),
  criterionDescription: z.string().nullable(),
  activitiesScore: z.number().nullable(),
  assessmentScore: z.number().nullable(),
})

const ReportGroupedLevelSchema = z.object({
  level: z.number(),
  rows: z.array(ReportCriterionRowSchema),
})

const ReportUnitSummaryRowSchema = z.object({
  unit_id: z.string(),
  unit_title: z.string().nullable(),
  unit_subject: z.string().nullable(),
  unit_description: z.string().nullable(),
  unit_year: z.number().nullable(),
  related_group_ids: z.array(z.string()).nullable().default([]),
  grouped_levels: z.array(ReportGroupedLevelSchema).default([]),
  working_level: z.number().nullable(),
  activities_average: z.number().nullable(),
  assessment_average: z.number().nullable(),
  assessment_level: z.string().nullable(),
  score_error: z.string().nullable(),
  objective_error: z.string().nullable(),
})

export type PreparedReportData = {
  profileName: string
  formattedDate: string
  exportFileName: string
  primaryMembership: ReportMembership | null
  feedbackByCriterion: Record<string, number>
  subjectEntries: ReportSubjectEntry[]
}

export type PreparedUnitReport = {
  profileName: string
  formattedDate: string
  subject: string
  unit: ReportUnitSummary
  lessons: UnitLessonContext["lessons"]
}

export async function getPreparedReportData(
  pupilId: string,
  groupIdFilter?: string,
  options?: { authEndTime?: number },
) {
  return withTelemetry(
    {
      routeTag: "reports",
      functionName: "getPreparedReportData",
      params: { pupilId, groupIdFilter: groupIdFilter ?? null },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      let profile: z.infer<typeof ProfileSchema> | null = null
      let memberships: z.infer<typeof GroupMembershipsWithGroupSchema> = []

      try {
        const { rows: profileRows } = await query(
          "select * from profiles where user_id = $1 limit 1",
          [pupilId],
        )
        profile = profileRows?.[0] ? ProfileSchema.nullable().parse(profileRows[0]) : null
      } catch (error) {
        console.error("[reports] Failed to load pupil profile via PG", { pupilId, error })
      }

      try {
        const { rows: membershipRows } = await query(
          `
            select gm.group_id, gm.user_id, 'member' as role, g.group_id as group_group_id, g.subject, g.join_code, g.active
            from group_membership gm
            left join groups g on g.group_id = gm.group_id
            where gm.user_id = $1
          `,
          [pupilId],
        )

        memberships = GroupMembershipsWithGroupSchema.parse(
          (membershipRows ?? []).map((row) => ({
            group_id: row.group_id,
            user_id: row.user_id,
            role: row.role,
            group:
              row.group_group_id !== null && row.group_group_id !== undefined
                ? {
                    group_id: row.group_group_id,
                    subject: row.subject,
                    join_code: row.join_code,
                    active: row.active,
                  }
                : undefined,
          })),
        )
      } catch (error) {
        console.error("[reports] Failed to load memberships via PG", { pupilId, error })
      }
      const membershipByGroupId = new Map(memberships.map((membership) => [membership.group_id, membership]))
      const primaryMembership = groupIdFilter ? membershipByGroupId.get(groupIdFilter) ?? null : null

      const profileName = (() => {
        const first = profile?.first_name?.trim() ?? ""
        const last = profile?.last_name?.trim() ?? ""
        const combined = `${first} ${last}`.trim()
        return combined.length > 0 ? combined : pupilId
      })()

      const now = new Date()
      const formattedDate = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(now)

      const exportDate = now.toISOString().slice(0, 10)
      const exportSlug = profileName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
      const exportFileName = `pupil-report-${exportSlug || pupilId}-${exportDate}.pdf`

      let unitSummaries = await readCachedUnitSummaries(pupilId, { groupIdFilter })
      let feedbackByCriterion = await fetchLatestFeedbackSnapshot(pupilId)

      if (unitSummaries.length === 0) {
        const dataset = await fetchReportDataset(pupilId, groupIdFilter)
        const fallbackFeedbackMap = buildFeedbackMapFromDataset(dataset.feedback)
        feedbackByCriterion = { ...fallbackFeedbackMap, ...feedbackByCriterion }
        unitSummaries = await buildDatasetUnitSummaries({
          dataset,
          pupilId,
          feedbackByCriterion,
          groupIdFilter,
          authEndTime: options?.authEndTime,
        })
      }

      const subjectEntries = buildSubjectEntries(unitSummaries)

      return {
        profileName,
        formattedDate,
        exportFileName,
        primaryMembership,
        feedbackByCriterion,
        subjectEntries,
      } satisfies PreparedReportData
    },
  )
}

export async function getPreparedUnitReport(
  pupilId: string,
  unitId: string,
  options?: { authEndTime?: number },
): Promise<PreparedUnitReport | null> {
  return withTelemetry(
    {
      routeTag: "reports",
      functionName: "getPreparedUnitReport",
      params: { pupilId, unitId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      const prepared = await getPreparedReportData(pupilId, undefined, {
        authEndTime: options?.authEndTime,
      })
      if (!prepared) {
        return null
      }

      for (const subjectEntry of prepared.subjectEntries) {
        const match = subjectEntry.units.find((unit) => unit.unitId === unitId)
        if (match) {
          // Fetch lesson/activity data for this unit
          const dataset = await fetchReportDataset(pupilId, undefined)
          const unitDataset = dataset.units.find((u) => u.unit_id === unitId)
          const lessonContext = await loadUnitLessonContextFromDataset(
            unitId,
            pupilId,
            unitDataset,
            options?.authEndTime
          )

          return {
            profileName: prepared.profileName,
            formattedDate: prepared.formattedDate,
            subject: subjectEntry.subject,
            unit: match,
            lessons: lessonContext.lessons,
          }
        }
      }

      return null
    },
  )
}

function buildSubjectEntries(unitSummaries: ReportUnitSummary[]): ReportSubjectEntry[] {
  const unitsBySubject = new Map<string, ReportUnitSummary[]>()
  unitSummaries.forEach((unit) => {
    const subjectKey = unit.unitSubject ?? "Subject not set"
    const existing = unitsBySubject.get(subjectKey) ?? []
    existing.push(unit)
    unitsBySubject.set(subjectKey, existing)
  })

  return Array.from(unitsBySubject.entries()).map(([subject, units]) => {
    const frequency = new Map<number, number>()
    units.forEach((unit) => {
      if (unit.workingLevel != null) {
        frequency.set(unit.workingLevel, (frequency.get(unit.workingLevel) ?? 0) + 1)
      }
    })

    let workingLevel: number | null = null
    let highestCount = 0
    for (const [level, count] of frequency.entries()) {
      if (count > highestCount || (count === highestCount && level > (workingLevel ?? -Infinity))) {
        workingLevel = level
        highestCount = count
      }
    }

    return {
      subject,
      workingLevel,
      units,
    }
  })
}

export async function buildDatasetUnitSummaries({
  dataset,
  pupilId,
  feedbackByCriterion,
  groupIdFilter,
  authEndTime,
}: {
  dataset: ReportDataset
  pupilId: string
  feedbackByCriterion: Record<string, number>
  groupIdFilter?: string
  authEndTime?: number
}): Promise<ReportUnitSummary[]> {
  const assignments = groupIdFilter
    ? dataset.assignments.filter((assignment) => assignment.group_id === groupIdFilter)
    : dataset.assignments

  const membershipByGroupId = new Map(dataset.memberships.map((membership) => [membership.group_id, membership]))

  const assignmentsByUnit = new Map<string, ReportAssignment[]>()
  const unitMeta = new Map<
    string,
    {
      title: string
      subject: string | null
      description: string | null
      year: number | null
    }
  >()

  for (const assignment of assignments) {
    const unitAssignments = assignmentsByUnit.get(assignment.unit_id) ?? []
    unitAssignments.push(assignment)
    assignmentsByUnit.set(assignment.unit_id, unitAssignments)

    if (!unitMeta.has(assignment.unit_id)) {
      const meta = assignment.unit
      unitMeta.set(assignment.unit_id, {
        title: meta?.title ?? assignment.unit_id,
        subject: meta?.subject ?? null,
        description: meta?.description ?? null,
        year: meta?.year ?? null,
      })
    }
  }

  const unitDatasetMap = new Map(dataset.units.map((unit) => [unit.unit_id, unit]))
  const summaries: ReportUnitSummary[] = []

  for (const [unitId, unitAssignments] of assignmentsByUnit.entries()) {
    const meta = unitMeta.get(unitId)
    const unitDataset = unitDatasetMap.get(unitId)
    const lessonContext = await loadUnitLessonContextFromDataset(unitId, pupilId, unitDataset, authEndTime)
    const { rows, unitAverages } = buildUnitRows({
      objectives: unitDataset?.learning_objectives ?? [],
      lessons: lessonContext.lessons,
      feedbackByCriterion,
      pupilId,
    })

    const groupedByLevelMap = new Map<number, ReportCriterionRow[]>()
    rows.forEach((row) => {
      const levelKey = row.level ?? 0
      const existing = groupedByLevelMap.get(levelKey) ?? []
      existing.push(row)
      groupedByLevelMap.set(levelKey, existing)
    })

    const groupedLevels = Array.from(groupedByLevelMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, levelRows]) => ({ level, rows: levelRows }))

    const workingLevel = (() => {
      let candidate: number | null = null
      groupedLevels.forEach(({ level, rows: levelRows }) => {
        const total = levelRows.length
        if (total === 0) return
        const positive = levelRows.filter((row) => (feedbackByCriterion[row.criterionId] ?? 0) > 0).length
        if (positive / total > 0.5) {
          candidate = level
        }
      })
      return candidate
    })()

    const activitiesAverage = unitAverages.activitiesAverage ?? lessonContext.scoreSummary.activitiesAverage
    const assessmentAverage = unitAverages.assessmentAverage ?? lessonContext.scoreSummary.assessmentAverage
    const unitYear = meta?.year ?? null
    const assessmentLevel =
      typeof unitYear === "number" && assessmentAverage !== null
        ? getLevelForYearScore(unitYear, assessmentAverage)
        : null

    const relatedGroups = unitAssignments.map(
      (assignment) => membershipByGroupId.get(assignment.group_id)?.group_id ?? assignment.group_id,
    )

    summaries.push({
      unitId,
      unitTitle: meta?.title ?? unitId,
      unitSubject: meta?.subject ?? "Subject not set",
      unitDescription: meta?.description ?? null,
      unitYear,
      relatedGroups: Array.from(new Set(relatedGroups)),
      objectiveError: null,
      groupedLevels,
      workingLevel,
      activitiesAverage,
      assessmentAverage,
      assessmentLevel,
      scoreError: lessonContext.scoreSummary.error,
    })
  }

  return summaries
}

function buildLessonSubmissionSummaries(
  activities: LessonActivity[],
  submissions: Submission[],
): LessonSubmissionSummary[] {
  const scorableActivities = activities.filter((activity) => isScorableActivityType(activity.type))

  const submissionsByActivity = new Map<string, Submission[]>()
  for (const submission of submissions) {
    const list = submissionsByActivity.get(submission.activity_id) ?? []
    list.push(submission)
    submissionsByActivity.set(submission.activity_id, list)
  }

  const summaries: LessonSubmissionSummary[] = []

  for (const activity of scorableActivities) {
    const activityType = (activity.type ?? "").trim()
    const activityTitle = (activity.title ?? "Untitled activity").trim() || "Untitled activity"
    const submissionList = submissionsByActivity.get(activity.activity_id) ?? []
    const successCriteriaIds = (activity.success_criteria_ids ?? []).filter((id): id is string =>
      typeof id === "string" && id.trim().length > 0,
    )
    const isSummative = (activity.is_summative ?? false) && isScorableActivityType(activity.type)

    const summary: LessonSubmissionSummary = {
      activityId: activity.activity_id,
      activityTitle,
      activityType,
      successCriteriaIds: successCriteriaIds.slice(),
      totalSubmissions: submissionList.length,
      averageScore: null,
      correctCount: null,
      scores: [],
      correctAnswer: null,
      isSummative,
    }

    if (submissionList.length === 0) {
      summaries.push(summary)
      continue
    }

    if (activityType === "multiple-choice-question") {
      const parsedActivity = McqActivityBodySchema.safeParse(activity.body_data)
      const mcqOptions = parsedActivity.success ? parsedActivity.data.options : []
      const correctOptionId = parsedActivity.success ? parsedActivity.data.correctOptionId : null
      const correctOption = correctOptionId ? mcqOptions.find((option) => option.id === correctOptionId) : undefined

      if (correctOption) {
        summary.correctAnswer = correctOption.text?.trim() || correctOptionId
      } else if (correctOptionId) {
        summary.correctAnswer = correctOptionId
      }

      const scoreEntries = submissionList
        .map((submission) => {
          const parsedSubmission = McqSubmissionBodySchema.safeParse(submission.body)
          if (!parsedSubmission.success) {
            return null
          }
          const isCorrect = parsedSubmission.data.is_correct === true
          const overrideScore =
            typeof parsedSubmission.data.teacher_override_score === "number" &&
            Number.isFinite(parsedSubmission.data.teacher_override_score)
              ? parsedSubmission.data.teacher_override_score
              : null
          const effectiveScore = overrideScore ?? (isCorrect ? 1 : 0)
          const successCriteriaScores = normaliseSuccessCriteriaScores({
            successCriteriaIds,
            existingScores: parsedSubmission.data.success_criteria_scores,
            fillValue: effectiveScore,
          })
          const score = computeAverageSuccessCriteriaScore(successCriteriaScores) ?? 0
          return {
            userId: submission.user_id,
            score,
            isCorrect,
            successCriteriaScores,
          }
        })
        .filter(
          (
            entry,
          ): entry is {
            userId: string
            score: number
            isCorrect: boolean
            successCriteriaScores: Record<string, number | null>
          } => entry !== null,
        )

      summary.scores = scoreEntries.map((entry) => ({
        userId: entry.userId,
        score: entry.score,
        isCorrect: entry.isCorrect,
        successCriteriaScores: entry.successCriteriaScores,
      }))
      summary.correctCount = scoreEntries.filter((entry) => entry.isCorrect).length

      if (scoreEntries.length > 0) {
        const activitiesScore = scoreEntries.reduce((acc, entry) => acc + entry.score, 0)
        summary.averageScore = activitiesScore / scoreEntries.length
      }
    } else if (activityType === "short-text-question") {
      const parsedActivity = ShortTextActivityBodySchema.safeParse(activity.body_data)
      if (parsedActivity.success) {
        const modelAnswer = parsedActivity.data.modelAnswer?.trim()
        if (modelAnswer) {
          summary.correctAnswer = modelAnswer
        }
      }

      const scoreEntries = submissionList
        .map((submission) => {
          const parsedSubmission = ShortTextSubmissionBodySchema.safeParse(submission.body)
          if (!parsedSubmission.success) {
            return null
          }

          const aiScore =
            typeof parsedSubmission.data.ai_model_score === "number" && Number.isFinite(parsedSubmission.data.ai_model_score)
              ? parsedSubmission.data.ai_model_score
              : null
          const overrideScore =
            typeof parsedSubmission.data.teacher_override_score === "number" &&
            Number.isFinite(parsedSubmission.data.teacher_override_score)
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
            successCriteriaScores,
          }
        })
        .filter(
          (
            entry,
          ): entry is {
            userId: string
            score: number
            isCorrect: boolean
            successCriteriaScores: Record<string, number | null>
          } => entry !== null,
        )

      summary.scores = scoreEntries.map((entry) => ({
        userId: entry.userId,
        score: entry.score,
        isCorrect: entry.isCorrect,
        successCriteriaScores: entry.successCriteriaScores,
      }))

      summary.correctCount = scoreEntries.filter((entry) => entry.isCorrect).length

      const numericScores = scoreEntries
        .filter((entry) => typeof entry.score === "number" && Number.isFinite(entry.score))
        .map((entry) => entry.score as number)

      if (numericScores.length > 0) {
        const activitiesScore = numericScores.reduce((acc, value) => acc + value, 0)
        summary.averageScore = activitiesScore / numericScores.length
      }
    } else {
      const generalScores = submissionList.map((submission) => {
        const body = submission.body
        let overrideScore: number | null = null
        let baseScore: number | null = null
        let successCriteriaScores: Record<string, number | null> | undefined

        if (body && typeof body === "object") {
          const record = body as Record<string, unknown>

          if (!summary.correctAnswer) {
            const correctValue = record.correctAnswer
            if (typeof correctValue === "string" && correctValue.trim().length > 0) {
              summary.correctAnswer = correctValue.trim()
            }
          }

          const override = record.teacher_override_score
          if (typeof override === "number" && Number.isFinite(override)) {
            overrideScore = override
          }

          const rawSuccessCriteria = record.success_criteria_scores
          if (rawSuccessCriteria && typeof rawSuccessCriteria === "object") {
            successCriteriaScores = rawSuccessCriteria as Record<string, number | null>
          }

          const scoreValue = record.score
          if (typeof scoreValue === "number" && Number.isFinite(scoreValue)) {
            baseScore = scoreValue
          } else if (typeof scoreValue === "string") {
            const parsed = Number.parseFloat(scoreValue)
            if (!Number.isNaN(parsed)) {
              baseScore = parsed
            }
          }
        }

        const normalisedScores = normaliseSuccessCriteriaScores({
          successCriteriaIds,
          existingScores: successCriteriaScores,
          fillValue: overrideScore ?? baseScore ?? 0,
        })

        const averagedScore = computeAverageSuccessCriteriaScore(normalisedScores)
        const finalScore = averagedScore ?? overrideScore ?? baseScore ?? null

        return {
          userId: submission.user_id,
          score: finalScore,
          successCriteriaScores: normalisedScores,
        }
      })

      summary.scores = generalScores

      const numericScores = generalScores.filter((entry) => typeof entry.score === "number") as Array<{
        userId: string
        score: number
      }>

      if (numericScores.length > 0) {
        const activitiesScore = numericScores.reduce((acc, entry) => acc + entry.score, 0)
        summary.averageScore = activitiesScore / numericScores.length
      }
    }

    summaries.push(summary)
  }

  return summaries
}

type LessonSuccessCriterionEntry = {
  lesson_id: string
  success_criteria_id: string
  title: string
  description: string | null
  level: number | null
  learning_objective_id: string | null
  is_summative: boolean
  activity_id: string | null
}

type LessonScoreAverages = {
  activitiesAverage: number | null
  assessmentAverage: number | null
}

type UnitLessonContext = {
  lessons: Array<
    LessonWithObjectives & {
      lesson_success_criteria?: LessonSuccessCriterionEntry[]
      scoreAverages?: LessonScoreAverages
      submissionSummaries?: LessonSubmissionSummary[]
    }
  >
  scoreSummary: { activitiesAverage: number | null; assessmentAverage: number | null; error: string | null }
}

export async function loadUnitLessonContextFromDataset(
  unitId: string,
  pupilId: string,
  unitDataset: ReportDataset["units"][number] | undefined,
  authEndTime?: number,
): Promise<UnitLessonContext> {
  return withTelemetry(
    {
      routeTag: "reports",
      functionName: "loadUnitLessonContextFromDataset",
      params: { unitId, pupilId },
      authEndTime: authEndTime ?? null,
    },
    async () => {
      if (!unitDataset) {
        return {
          lessons: [],
          scoreSummary: { activitiesAverage: null, assessmentAverage: null, error: null },
        }
      }

      const lessons = unitDataset.lessons ?? []
      if (lessons.length === 0) {
        return {
          lessons: [],
          scoreSummary: { activitiesAverage: null, assessmentAverage: null, error: null },
        }
      }

      let activitiesScoreSum = 0
      let totalActivityCount = 0
      let summativeScoreSum = 0
      let summativeActivityCount = 0
      const enrichedLessons: UnitLessonContext["lessons"] = []

      for (const lesson of lessons) {
        const lessonId = lesson.lesson_id
        if (!lessonId) continue

        const activitySummativeFlags = new Map<string, boolean>()
        for (const activity of lesson.activities ?? []) {
          if (!activity?.activity_id) continue
          const isSummative = (activity.is_summative ?? false) && isScorableActivityType(activity.type)
          activitySummativeFlags.set(activity.activity_id, isSummative)
        }

        const enrichedCriteria: LessonSuccessCriterionEntry[] = (lesson.lesson_success_criteria ?? []).map(
          (criterion) => {
            const title =
              typeof criterion.title === "string" && criterion.title.trim().length > 0
                ? criterion.title.trim()
                : "Success criterion"
            const activityId = criterion.activity_id ?? null
            return {
              lesson_id: lessonId,
              success_criteria_id: criterion.success_criteria_id,
              title,
              description: criterion.description ?? null,
              level: typeof criterion.level === "number" ? criterion.level : null,
              learning_objective_id: criterion.learning_objective_id ?? null,
              activity_id: activityId,
              is_summative: activityId ? activitySummativeFlags.get(activityId) ?? false : false,
            }
          },
        )
        enrichedCriteria.sort((a, b) => a.title.localeCompare(b.title))

        const submissionSummaries = buildLessonSubmissionSummaries(lesson.activities ?? [], lesson.submissions ?? [])

        let lessonTotalSum = 0
        let lessonActivityCount = 0
        let lessonAssessmentSum = 0
        let lessonAssessmentCount = 0

        for (const summary of submissionSummaries) {
          const pupilScores = summary.scores.filter(
            (entry) =>
              entry.userId === pupilId &&
              typeof entry.score === "number" &&
              Number.isFinite(entry.score),
          )
          if (pupilScores.length === 0) {
            continue
          }

          const activityAverage =
            pupilScores.reduce((acc, entry) => acc + (entry.score ?? 0), 0) / pupilScores.length

          activitiesScoreSum += activityAverage
          totalActivityCount += 1

          lessonTotalSum += activityAverage
          lessonActivityCount += 1

          if (summary.isSummative) {
            summativeScoreSum += activityAverage
            summativeActivityCount += 1

            lessonAssessmentSum += activityAverage
            lessonAssessmentCount += 1
          }
        }

        const lessonTotalAverage = lessonActivityCount > 0 ? lessonTotalSum / lessonActivityCount : null
        const lessonAssessmentAverage =
          lessonAssessmentCount > 0 ? lessonAssessmentSum / lessonAssessmentCount : null

        const { activities, submissions, ...lessonBase } = lesson
        const normalizedLesson = lessonBase as LessonWithObjectives

        enrichedLessons.push({
          ...normalizedLesson,
          lesson_success_criteria: enrichedCriteria,
          scoreAverages: {
            activitiesAverage: lessonTotalAverage,
            assessmentAverage: lessonAssessmentAverage,
          },
          submissionSummaries,
        })
      }

      const activitiesAverage = totalActivityCount > 0 ? activitiesScoreSum / totalActivityCount : null
      const assessmentAverage = summativeActivityCount > 0 ? summativeScoreSum / summativeActivityCount : null

      return {
        lessons: enrichedLessons,
        scoreSummary: {
          activitiesAverage,
          assessmentAverage,
          error: null,
        },
      }
    },
  )
}

export function buildUnitRows({
  objectives,
  lessons,
  feedbackByCriterion,
  pupilId,
}: {
  objectives: LearningObjectiveWithCriteria[]
  lessons: UnitLessonContext["lessons"]
  feedbackByCriterion: Record<string, number>
  pupilId: string
}): { rows: ReportCriterionRow[]; unitAverages: { activitiesAverage: number | null; assessmentAverage: number | null } } {
  const objectiveMeta = new Map<
    string,
    {
      assessmentObjectiveCode: string | null
      assessmentObjectiveTitle: string | null
      title: string
    }
  >()

  for (const objective of objectives ?? []) {
    objectiveMeta.set(objective.learning_objective_id, {
      assessmentObjectiveCode: objective.assessment_objective_code ?? null,
      assessmentObjectiveTitle: objective.assessment_objective_title ?? null,
      title: objective.title,
    })
  }

  const criterionToObjective = new Map<string, string>()

  const lessonObjectives = lessons.flatMap((lesson) => lesson.lesson_objectives ?? [])
  for (const entry of lessonObjectives) {
    const learningObjective = entry.learning_objective
    if (!learningObjective) continue
    const existing = objectiveMeta.get(learningObjective.learning_objective_id)
    if (!existing) {
      objectiveMeta.set(learningObjective.learning_objective_id, {
        assessmentObjectiveCode: learningObjective.assessment_objective_code ?? null,
        assessmentObjectiveTitle: learningObjective.assessment_objective_title ?? null,
        title: learningObjective.title ?? entry.title ?? "Learning objective",
      })
      console.log("[reports] Objective metadata populated from lesson link", {
        learningObjectiveId: learningObjective.learning_objective_id,
        title: learningObjective.title ?? entry.title ?? "Learning objective",
      })
    } else {
      if (!existing.assessmentObjectiveCode && learningObjective.assessment_objective_code) {
        existing.assessmentObjectiveCode = learningObjective.assessment_objective_code
      }
      if (!existing.assessmentObjectiveTitle && learningObjective.assessment_objective_title) {
        existing.assessmentObjectiveTitle = learningObjective.assessment_objective_title
      }
      if ((!existing.title || existing.title.length === 0) && learningObjective.title) {
        existing.title = learningObjective.title
      }
      objectiveMeta.set(learningObjective.learning_objective_id, existing)
    }
  }

  for (const lesson of lessons) {
    for (const criterion of lesson.lesson_success_criteria ?? []) {
      const criterionId = criterion.success_criteria_id
      const objectiveId = criterion.learning_objective_id ?? null
      if (!criterionId || !objectiveId) continue

      criterionToObjective.set(criterionId, objectiveId)

      if (!objectiveMeta.has(objectiveId)) {
        objectiveMeta.set(objectiveId, {
          assessmentObjectiveCode: null,
          assessmentObjectiveTitle: null,
          title: "Learning objective",
        })
        console.log("[reports] Missing objective metadata while mapping criteria, using placeholder", {
          successCriteriaId: criterionId,
          learningObjectiveId: objectiveId,
        })
      }
    }
  }

  const criterionTotals = new Map<
    string,
    {
      total: number
      count: number
      summativeTotal: number
      summativeCount: number
    }
  >()

  const declaredCriterionIds = new Set<string>()
  const criterionSummativeFlags = new Map<string, boolean>()
  for (const lesson of lessons) {
    for (const criterion of lesson.lesson_success_criteria ?? []) {
      if (criterion?.success_criteria_id) {
        declaredCriterionIds.add(criterion.success_criteria_id)
        const isSummative = criterion.is_summative ?? false
        if (isSummative) {
          criterionSummativeFlags.set(criterion.success_criteria_id, true)
        } else if (!criterionSummativeFlags.has(criterion.success_criteria_id)) {
          criterionSummativeFlags.set(criterion.success_criteria_id, false)
        }
      }
    }
  }

  for (const lesson of lessons) {
    console.log("[reports] Processing lesson summaries", {
      lessonId: lesson.lesson_id,
      summaryCount: lesson.submissionSummaries?.length ?? 0,
    })
    for (const summary of lesson.submissionSummaries ?? []) {
      const isSummative = summary.isSummative === true

      const declaredSuccessCriteria =
        Array.isArray(summary.successCriteriaIds) && summary.successCriteriaIds.length > 0
          ? summary.successCriteriaIds
          : Array.from(
              new Set(
                (summary.scores ?? []).flatMap((entry) =>
                  Object.keys(entry.successCriteriaScores ?? {}),
                ),
              ),
            )

      if (declaredSuccessCriteria.length === 0) {
        continue
      }

      const pupilEntry = (summary.scores ?? []).find((entry) => entry.userId === pupilId)

      const appendScore = (criterionId: string, raw: number | null | undefined) => {
        if (!criterionId) return
        const numeric = typeof raw === "number" && Number.isFinite(raw) ? raw : 0
        console.log("[reports] Criterion score contribution", {
          unitId: lessons[0]?.unit_id ?? null,
          lessonId: lesson.lesson_id,
          activityId: summary.activityId,
          criterionId,
          raw,
          numeric,
          isSummative,
          hadSubmission: Boolean(pupilEntry),
        })
        const slot = criterionTotals.get(criterionId) ?? {
          total: 0,
          count: 0,
          summativeTotal: 0,
          summativeCount: 0,
        }
        slot.total += numeric
        slot.count += 1
        if (isSummative) {
          slot.summativeTotal += numeric
          slot.summativeCount += 1
        }
        criterionTotals.set(criterionId, slot)
      }

      if (pupilEntry) {
        for (const criterionId of declaredSuccessCriteria) {
          if (isSummative) {
            criterionSummativeFlags.set(criterionId, true)
          }
          const raw = (pupilEntry.successCriteriaScores ?? {})[criterionId]
          appendScore(criterionId, raw)
        }
      } else {
        for (const criterionId of declaredSuccessCriteria) {
          if (isSummative) {
            criterionSummativeFlags.set(criterionId, true)
          }
          appendScore(criterionId, 0)
        }
      }
    }
  }

  for (const criterionId of declaredCriterionIds) {
    const isSummativeCriterion = criterionSummativeFlags.get(criterionId) === true
    const existing = criterionTotals.get(criterionId)
    if (!existing) {
      criterionTotals.set(criterionId, {
        total: 0,
        count: 1,
        summativeTotal: 0,
        summativeCount: isSummativeCriterion ? 1 : 0,
      })
    } else if (isSummativeCriterion && existing.summativeCount === 0) {
      existing.summativeCount += 1
    }
  }

  const criterionAverages = new Map<
    string,
    {
      activitiesAverage: number | null
      assessmentAverage: number | null
    }
  >()

  for (const [criterionId, totals] of criterionTotals.entries()) {
    criterionAverages.set(criterionId, {
      activitiesAverage: totals.count > 0 ? totals.total / totals.count : null,
      assessmentAverage: totals.summativeCount > 0 ? totals.summativeTotal / totals.summativeCount : null,
    })
  }

  const objectiveScoreTotals = new Map<
    string,
    {
      total: number
      count: number
      summativeTotal: number
      summativeCount: number
    }
  >()

  for (const [criterionId, totals] of criterionTotals.entries()) {
    const objectiveId = criterionToObjective.get(criterionId)
    if (!objectiveId) continue

    const slot = objectiveScoreTotals.get(objectiveId) ?? {
      total: 0,
      count: 0,
      summativeTotal: 0,
      summativeCount: 0,
    }
    slot.total += totals.total
    slot.count += totals.count
    slot.summativeTotal += totals.summativeTotal
    slot.summativeCount += totals.summativeCount
    objectiveScoreTotals.set(objectiveId, slot)
  }

  const objectiveScoreAverages = new Map<
    string,
    {
      activitiesAverage: number | null
      assessmentAverage: number | null
    }
  >()

  for (const [loId, totals] of objectiveScoreTotals.entries()) {
    objectiveScoreAverages.set(loId, {
      activitiesAverage: totals.count > 0 ? totals.total / totals.count : null,
      assessmentAverage: totals.summativeCount > 0 ? totals.summativeTotal / totals.summativeCount : null,
    })
  }

  const rows: ReportCriterionRow[] = []
  const seenCriteria = new Set<string>()
  const objectivesWithCriteria = new Set<string>()

  const lessonCriteria = lessons.flatMap((lesson) => lesson.lesson_success_criteria ?? [])

  for (const criterion of lessonCriteria) {
    const criterionId = criterion.success_criteria_id
    if (!criterionId || seenCriteria.has(criterionId)) {
      continue
    }
    seenCriteria.add(criterionId)

    const learningObjectiveId = criterion.learning_objective_id ?? ""
    if (!learningObjectiveId) continue

    const meta = objectiveMeta.get(learningObjectiveId)
    const assessmentObjectiveCode = meta?.assessmentObjectiveCode ?? null
    const assessmentObjectiveTitle = meta?.assessmentObjectiveTitle ?? "Unassigned Assessment Objective"
    const objectiveTitle = meta?.title ?? "Learning objective"

    objectivesWithCriteria.add(learningObjectiveId)

    const criterionAverage = criterionAverages.get(criterionId)

    rows.push({
      level: typeof criterion.level === "number" ? criterion.level : deriveLevelFromFeedback(criterionId, feedbackByCriterion),
      assessmentObjectiveCode,
      assessmentObjectiveTitle,
      objectiveTitle,
      learningObjectiveId,
      criterionId,
      criterionDescription:
        criterion.description && criterion.description.trim().length > 0
          ? criterion.description.trim()
          : "No description provided.",
      activitiesScore: criterionAverage?.activitiesAverage ?? null,
      assessmentScore: criterionAverage?.assessmentAverage ?? null,
    })
  }

  for (const entry of lessonObjectives) {
    const learningObjective = entry.learning_objective
    const learningObjectiveId = learningObjective?.learning_objective_id ?? entry.learning_objective_id ?? ""
    if (!learningObjectiveId) continue

    if (objectivesWithCriteria.has(learningObjectiveId)) continue

    const meta = objectiveMeta.get(learningObjectiveId)
    rows.push({
      level: 0,
      assessmentObjectiveCode: meta?.assessmentObjectiveCode ?? null,
      assessmentObjectiveTitle: meta?.assessmentObjectiveTitle ?? "Unassigned Assessment Objective",
      objectiveTitle: meta?.title ?? entry.title ?? "Learning objective",
      learningObjectiveId,
      criterionId: `${learningObjectiveId}-placeholder`,
      criterionDescription: "No success criteria have been linked yet.",
      activitiesScore: objectiveScoreAverages.get(learningObjectiveId)?.activitiesAverage ?? null,
      assessmentScore: objectiveScoreAverages.get(learningObjectiveId)?.assessmentAverage ?? null,
    })
  }

  let aggregateActivitiesSum = 0
  let aggregateActivitiesCount = 0
  let aggregateAssessmentSum = 0
  let aggregateAssessmentCount = 0

  for (const averages of criterionAverages.values()) {
    const activitiesAverage = averages.activitiesAverage
    const assessmentAverage = averages.assessmentAverage

    if (typeof activitiesAverage === "number" && Number.isFinite(activitiesAverage)) {
      aggregateActivitiesSum += activitiesAverage
      aggregateActivitiesCount += 1
    }
    if (typeof assessmentAverage === "number" && Number.isFinite(assessmentAverage)) {
      aggregateAssessmentSum += assessmentAverage
      aggregateAssessmentCount += 1
    }
  }

  const unitAverages = {
    activitiesAverage:
      aggregateActivitiesCount > 0 ? aggregateActivitiesSum / aggregateActivitiesCount : null,
    assessmentAverage:
      aggregateAssessmentCount > 0 ? aggregateAssessmentSum / aggregateAssessmentCount : null,
  }

  return { rows, unitAverages }
}

function deriveLevelFromFeedback(criterionId: string, feedbackByCriterion: Record<string, number>): number {
  const rating = feedbackByCriterion[criterionId]
  if (typeof rating === "number" && rating > 0) {
    return 1
  }
  return 0
}
