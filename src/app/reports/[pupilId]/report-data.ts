import { readLearningObjectivesByUnitAction, readPupilReportAction } from "@/lib/server-updates"

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

    const relatedGroups = unitAssignments.map(
      (assignment) => membershipByGroupId.get(assignment.group_id)?.group_id ?? assignment.group_id,
    )
    const assignedUnitIds = new Set(unitAssignments.map((assignment) => assignment.unit_id))

    const rows = objectives.flatMap((objective) =>
      (objective.success_criteria ?? [])
        .filter((criterion) => {
          const units = criterion.units ?? []
          if (assignedUnitIds.size === 0) return false
          return units.some((unit) => assignedUnitIds.has(unit))
        })
        .map((criterion) => ({
          level: criterion.level,
          assessmentObjectiveCode: objective.assessment_objective_code ?? "AO",
          assessmentObjectiveTitle: objective.assessment_objective_title ?? null,
          objectiveTitle: objective.title,
          criterionId: criterion.success_criteria_id,
          criterionDescription: criterion.description ?? null,
        })),
    )

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
