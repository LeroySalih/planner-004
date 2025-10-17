import {
  readLearningObjectivesByUnitAction,
  readLessonsByUnitAction,
  readLessonSubmissionSummariesAction,
  readPupilReportAction,
} from "@/lib/server-updates"
import type { LessonWithObjectives } from "@/types"

export type ReportDataResult = Awaited<ReturnType<typeof readPupilReportAction>>
export type LoadedReport = NonNullable<ReportDataResult["data"]>
export type ReportMembership = LoadedReport["memberships"][number]
export type ReportAssignment = LoadedReport["assignments"][number]

export type ReportCriterionRow = {
  level: number
  assessmentObjectiveCode: string
  assessmentObjectiveTitle: string | null
  objectiveTitle: string
  criterionId: string
  criterionDescription: string | null
  totalScore: number | null
  assessmentScore: number | null
}

export type ReportUnitSummary = {
  unitId: string
  unitTitle: string
  unitSubject: string | null
  unitDescription: string | null
  relatedGroups: string[]
  objectiveError: string | null | undefined
  groupedLevels: Array<{
    level: number
    rows: ReportCriterionRow[]
  }>
  workingLevel: number | null
  totalAverage: number | null
  summativeAverage: number | null
  scoreError: string | null
}

export type ReportSubjectEntry = {
  subject: string
  workingLevel: number | null
  units: ReportUnitSummary[]
}

export type PreparedReportData = {
  profileName: string
  formattedDate: string
  exportFileName: string
  primaryMembership: ReportMembership | null
  feedbackByCriterion: Record<string, number>
  subjectEntries: ReportSubjectEntry[]
}

export async function getPreparedReportData(pupilId: string, groupIdFilter?: string) {
  const reportResult = await readPupilReportAction(pupilId)

  if (reportResult.error && !reportResult.data) {
    throw new Error(reportResult.error)
  }

  const report = reportResult.data

  if (!report) {
    return null
  }

  const assignments = groupIdFilter
    ? report.assignments.filter((assignment) => assignment.group_id === groupIdFilter)
    : report.assignments

  const membershipByGroupId = new Map(report.memberships.map((membership) => [membership.group_id, membership]))
  const primaryMembership = groupIdFilter ? membershipByGroupId.get(groupIdFilter) ?? null : null

  const profileName = (() => {
    const first = report.profile?.first_name?.trim() ?? ""
    const last = report.profile?.last_name?.trim() ?? ""
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

  const assignmentsByUnit = new Map<string, ReportAssignment[]>()
  const unitMeta = new Map<
    string,
    {
      title: string
      subject: string | null
      description: string | null
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
      })
    }
  }

  const objectivesByUnit = new Map<string, Awaited<ReturnType<typeof readLearningObjectivesByUnitAction>>>()
  await Promise.all(
    Array.from(assignmentsByUnit.keys()).map(async (unitId) => {
      const result = await readLearningObjectivesByUnitAction(unitId)
      objectivesByUnit.set(unitId, result)
    }),
  )

  const latestFeedbackByCriterion = new Map<string, { rating: number; id: number }>()
  for (const entry of report.feedback) {
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

  const unitsBySubject = new Map<string, ReportUnitSummary[]>()

  for (const [unitId, unitAssignments] of assignmentsByUnit.entries()) {
    const meta = unitMeta.get(unitId)
    const objectivesResult = objectivesByUnit.get(unitId)
    const objectives = objectivesResult?.data ?? []
    const objectiveError = objectivesResult?.error
    const lessonContext = await loadUnitLessonContext(unitId, pupilId)
    const lessons = lessonContext.lessons
    const scoreSummary = lessonContext.scoreSummary

    const relatedGroups = unitAssignments.map(
      (assignment) => membershipByGroupId.get(assignment.group_id)?.group_id ?? assignment.group_id,
    )

    const rows = buildUnitRows({
      objectives,
      lessons,
      feedbackByCriterion,
    })

    const groupedByLevelMap = new Map<number, typeof rows>()
    rows.forEach((row) => {
      const levelRows = groupedByLevelMap.get(row.level) ?? ([] as typeof rows)
      levelRows.push(row)
      groupedByLevelMap.set(row.level, levelRows)
    })

    const groupedLevels = Array.from(groupedByLevelMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, levelRows]) => ({ level, rows: levelRows }))

    const workingLevel = (() => {
      let candidate: number | null = null
      groupedLevels.forEach(({ level, rows: levelRows }) => {
        const total = levelRows.length
        const positive = levelRows.filter((row) => (feedbackByCriterion[row.criterionId] ?? 0) > 0).length
        if (total > 0 && positive / total > 0.5) {
          candidate = level
        }
      })
      return candidate
    })()

    const subjectKey = meta?.subject ?? "Subject not set"
    const existingUnits = unitsBySubject.get(subjectKey) ?? []
    existingUnits.push({
      unitId,
      unitTitle: meta?.title ?? unitId,
      unitSubject: meta?.subject ?? null,
      unitDescription: meta?.description ?? null,
      relatedGroups: Array.from(new Set(relatedGroups)),
      objectiveError,
      groupedLevels,
      workingLevel,
      totalAverage: scoreSummary.totalAverage,
      summativeAverage: scoreSummary.summativeAverage,
      scoreError: scoreSummary.error,
    })
    unitsBySubject.set(subjectKey, existingUnits)
  }

  const subjectEntries: ReportSubjectEntry[] = Array.from(unitsBySubject.entries()).map(([subject, units]) => {
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

  return {
    profileName,
    formattedDate,
    exportFileName,
    primaryMembership,
    feedbackByCriterion,
    subjectEntries,
  } satisfies PreparedReportData
}

type LessonSuccessCriterionEntry = {
  lesson_id: string
  success_criteria_id: string
  title: string
  description: string | null
  level: number | null
  learning_objective_id: string | null
}

type LessonScoreAverages = {
  totalAverage: number | null
  assessmentAverage: number | null
}

type UnitLessonContext = {
  lessons: Array<
    LessonWithObjectives & {
      lesson_success_criteria?: LessonSuccessCriterionEntry[]
      scoreAverages?: LessonScoreAverages
    }
  >
  scoreSummary: { totalAverage: number | null; summativeAverage: number | null; error: string | null }
}

async function loadUnitLessonContext(unitId: string, pupilId: string): Promise<UnitLessonContext> {
  const lessonsResult = await readLessonsByUnitAction(unitId)

  if (lessonsResult.error) {
    return {
      lessons: [],
      scoreSummary: { totalAverage: null, summativeAverage: null, error: lessonsResult.error },
    }
  }

  const lessons = (lessonsResult.data ?? []) as Array<
    LessonWithObjectives & { lesson_success_criteria?: LessonSuccessCriterionEntry[] }
  >
  if (lessons.length === 0) {
    return {
      lessons: [],
      scoreSummary: { totalAverage: null, summativeAverage: null, error: null },
    }
  }

  let totalScoreSum = 0
  let totalActivityCount = 0
  let summativeScoreSum = 0
  let summativeActivityCount = 0
  let firstError: string | null = null
  const lessonAverageMap = new Map<string, LessonScoreAverages>()

  for (const lesson of lessons) {
    const lessonId = lesson.lesson_id
    if (!lessonId) continue

    let lessonTotalSum = 0
    let lessonActivityCount = 0
    let lessonAssessmentSum = 0
    let lessonAssessmentCount = 0

    const { data: summaries, error } = await readLessonSubmissionSummariesAction(lessonId, {
      userId: pupilId,
    })

    if (error && !firstError) {
      firstError = error
    }

    for (const summary of summaries) {
      const pupilScores = summary.scores.filter(
        (entry) => entry.userId === pupilId && typeof entry.score === "number" && Number.isFinite(entry.score),
      )
      if (pupilScores.length === 0) {
        continue
      }

      const activityAverage =
        pupilScores.reduce((acc, entry) => acc + (entry.score ?? 0), 0) / pupilScores.length

      totalScoreSum += activityAverage
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

    lessonAverageMap.set(lessonId, {
      totalAverage: lessonTotalAverage,
      assessmentAverage: lessonAssessmentAverage,
    })
  }

  const totalAverage = totalActivityCount > 0 ? totalScoreSum / totalActivityCount : null
  const summativeAverage = summativeActivityCount > 0 ? summativeScoreSum / summativeActivityCount : null

  const enrichedLessons = lessons.map((lesson) => ({
    ...lesson,
    scoreAverages:
      lessonAverageMap.get(lesson.lesson_id ?? "") ?? {
        totalAverage: null,
        assessmentAverage: null,
      },
  }))

  return {
    lessons: enrichedLessons,
    scoreSummary: {
      totalAverage,
      summativeAverage,
      error: firstError,
    },
  }
}

function buildUnitRows({
  objectives,
  lessons,
  feedbackByCriterion,
}: {
  objectives: Awaited<ReturnType<typeof readLearningObjectivesByUnitAction>>["data"] extends infer T ? (T extends Array<infer U> ? U[] : []) : []
  lessons: UnitLessonContext["lessons"]
  feedbackByCriterion: Record<string, number>
}): ReportCriterionRow[] {
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

  const lessonObjectives = lessons.flatMap((lesson) => lesson.lessons_learning_objective ?? [])
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
    }
  }

  const objectiveScoreTotals = new Map<
    string,
    {
      total: number
      totalCount: number
      assessment: number
      assessmentCount: number
    }
  >()

  for (const lesson of lessons) {
    const lessonObjectives = lesson.lessons_learning_objective ?? []
    if (lessonObjectives.length === 0) continue

    const uniqueObjectiveIds = new Set<string>()
    for (const entry of lessonObjectives) {
      const loId = entry.learning_objective?.learning_objective_id ?? entry.learning_objective_id
      if (loId) {
        uniqueObjectiveIds.add(loId)
      }
    }

    if (uniqueObjectiveIds.size === 0) continue

    const averages = lesson.scoreAverages
    const totalAverage = averages?.totalAverage ?? null
    const assessmentAverage = averages?.assessmentAverage ?? null

    for (const loId of uniqueObjectiveIds) {
      const slot = objectiveScoreTotals.get(loId) ?? {
        total: 0,
        totalCount: 0,
        assessment: 0,
        assessmentCount: 0,
      }
      if (typeof totalAverage === "number" && Number.isFinite(totalAverage)) {
        slot.total += totalAverage
        slot.totalCount += 1
      }
      if (typeof assessmentAverage === "number" && Number.isFinite(assessmentAverage)) {
        slot.assessment += assessmentAverage
        slot.assessmentCount += 1
      }
      objectiveScoreTotals.set(loId, slot)
    }
  }

  const objectiveScoreAverages = new Map<
    string,
    {
      totalAverage: number | null
      assessmentAverage: number | null
    }
  >()

  for (const [loId, totals] of objectiveScoreTotals.entries()) {
    objectiveScoreAverages.set(loId, {
      totalAverage: totals.totalCount > 0 ? totals.total / totals.totalCount : null,
      assessmentAverage: totals.assessmentCount > 0 ? totals.assessment / totals.assessmentCount : null,
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
    const assessmentObjectiveCode = meta?.assessmentObjectiveCode ?? "AO"
    const assessmentObjectiveTitle = meta?.assessmentObjectiveTitle ?? null
    const objectiveTitle = meta?.title ?? "Learning objective"

    objectivesWithCriteria.add(learningObjectiveId)

    const averages = objectiveScoreAverages.get(learningObjectiveId)

    rows.push({
      level: typeof criterion.level === "number" ? criterion.level : deriveLevelFromFeedback(criterionId, feedbackByCriterion),
      assessmentObjectiveCode,
      assessmentObjectiveTitle,
      objectiveTitle,
      criterionId,
      criterionDescription:
        criterion.description && criterion.description.trim().length > 0
          ? criterion.description.trim()
          : "No description provided.",
      totalScore: averages?.totalAverage ?? null,
      assessmentScore: averages?.assessmentAverage ?? null,
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
      assessmentObjectiveCode: meta?.assessmentObjectiveCode ?? "AO",
      assessmentObjectiveTitle: meta?.assessmentObjectiveTitle ?? null,
      objectiveTitle: meta?.title ?? entry.title ?? "Learning objective",
      criterionId: `${learningObjectiveId}-placeholder`,
      criterionDescription: "No success criteria have been linked yet.",
      totalScore: objectiveScoreAverages.get(learningObjectiveId)?.totalAverage ?? null,
      assessmentScore: objectiveScoreAverages.get(learningObjectiveId)?.assessmentAverage ?? null,
    })
  }

  return rows
}

function deriveLevelFromFeedback(criterionId: string, feedbackByCriterion: Record<string, number>): number {
  const rating = feedbackByCriterion[criterionId]
  if (typeof rating === "number" && rating > 0) {
    return 1
  }
  return 0
}
