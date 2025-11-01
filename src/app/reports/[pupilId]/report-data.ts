import {
  readLearningObjectivesByUnitAction,
  readLessonsByUnitAction,
  readLessonSubmissionSummariesAction,
  readPupilReportAction,
} from "@/lib/server-updates"
import type { LessonSubmissionSummary, LessonWithObjectives } from "@/types"
import { getLevelForYearScore } from "@/lib/levels"
import { withTelemetry } from "@/lib/telemetry"

export type ReportDataResult = Awaited<ReturnType<typeof readPupilReportAction>>
export type LoadedReport = NonNullable<ReportDataResult["data"]>
export type ReportMembership = LoadedReport["memberships"][number]
export type ReportAssignment = LoadedReport["assignments"][number]

export type ReportCriterionRow = {
  level: number
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
        const lessonContext = await loadUnitLessonContext(unitId, pupilId, options?.authEndTime)
        const lessons = lessonContext.lessons
        const scoreSummary = lessonContext.scoreSummary

        const relatedGroups = unitAssignments.map(
          (assignment) => membershipByGroupId.get(assignment.group_id)?.group_id ?? assignment.group_id,
        )

        const { rows, unitAverages } = buildUnitRows({
          objectives,
          lessons,
          feedbackByCriterion,
          pupilId,
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

        const activitiesAverage = unitAverages.activitiesAverage ?? scoreSummary.activitiesAverage
        const assessmentAverage = unitAverages.assessmentAverage ?? scoreSummary.assessmentAverage
        const unitYear = meta?.year ?? null
        const assessmentLevel =
          typeof unitYear === "number" && assessmentAverage !== null
            ? getLevelForYearScore(unitYear, assessmentAverage)
            : null

        const subjectKey = meta?.subject ?? "Subject not set"
        const existingUnits = unitsBySubject.get(subjectKey) ?? []
        existingUnits.push({
          unitId,
          unitTitle: meta?.title ?? unitId,
          unitSubject: meta?.subject ?? null,
          unitDescription: meta?.description ?? null,
          unitYear,
          relatedGroups: Array.from(new Set(relatedGroups)),
          objectiveError,
          groupedLevels,
          workingLevel,
          activitiesAverage,
          assessmentAverage,
          assessmentLevel,
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
          return {
            profileName: prepared.profileName,
            formattedDate: prepared.formattedDate,
            subject: subjectEntry.subject,
            unit: match,
          }
        }
      }

      return null
    },
  )
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

async function loadUnitLessonContext(
  unitId: string,
  pupilId: string,
  authEndTime?: number,
): Promise<UnitLessonContext> {
  return withTelemetry(
    {
      routeTag: "reports",
      functionName: "loadUnitLessonContext",
      params: { unitId, pupilId },
      authEndTime: authEndTime ?? null,
    },
    async () => {
      const lessonsResult = await readLessonsByUnitAction(unitId)

      if (lessonsResult.error) {
        return {
          lessons: [],
          scoreSummary: { activitiesAverage: null, assessmentAverage: null, error: lessonsResult.error },
        }
      }

      const lessons = (lessonsResult.data ?? []) as Array<
        LessonWithObjectives & { lesson_success_criteria?: LessonSuccessCriterionEntry[] }
      >
      if (lessons.length === 0) {
        console.log("[reports] No lessons returned for unit", { unitId })
        return {
          lessons: [],
          scoreSummary: { activitiesAverage: null, assessmentAverage: null, error: null },
        }
      }

      let activitiesScoreSum = 0
      let totalActivityCount = 0
      let summativeScoreSum = 0
      let summativeActivityCount = 0
      let firstError: string | null = null
      const lessonAverageMap = new Map<string, LessonScoreAverages>()
      const lessonSummariesMap = new Map<string, LessonSubmissionSummary[]>()

      for (const lesson of lessons) {
        const lessonId = lesson.lesson_id
        if (!lessonId) continue

        const objectiveTitles = lesson.lesson_objectives?.map((entry) => ({
          lessonObjectiveId: entry.learning_objective_id ?? entry.learning_objective?.learning_objective_id ?? null,
          title: entry.title,
          linkedTitle: entry.learning_objective?.title ?? null,
        }))
        console.log("[reports] Lesson objectives hydrated", {
          unitId,
          lessonId,
          objectiveCount: objectiveTitles?.length ?? 0,
          objectives: objectiveTitles,
        })

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

        lessonAverageMap.set(lessonId, {
          activitiesAverage: lessonTotalAverage,
          assessmentAverage: lessonAssessmentAverage,
        })

        lessonSummariesMap.set(lessonId, summaries)
      }

      const activitiesAverage = totalActivityCount > 0 ? activitiesScoreSum / totalActivityCount : null
      const assessmentAverage = summativeActivityCount > 0 ? summativeScoreSum / summativeActivityCount : null

      const enrichedLessons = lessons.map((lesson) => ({
        ...lesson,
        scoreAverages:
          lessonAverageMap.get(lesson.lesson_id ?? "") ?? {
            activitiesAverage: null,
            assessmentAverage: null,
          },
        submissionSummaries: lessonSummariesMap.get(lesson.lesson_id ?? "") ?? [],
      }))

      return {
        lessons: enrichedLessons,
        scoreSummary: {
          activitiesAverage,
          assessmentAverage,
          error: firstError,
        },
      }
    },
  )
}

function buildUnitRows({
  objectives,
  lessons,
  feedbackByCriterion,
  pupilId,
}: {
  objectives: Awaited<ReturnType<typeof readLearningObjectivesByUnitAction>>["data"] extends infer T ? (T extends Array<infer U> ? U[] : []) : []
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
