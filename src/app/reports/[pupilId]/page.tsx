import Link from "next/link"
import { notFound } from "next/navigation"
import { ThumbsDown, ThumbsUp, Minus } from "lucide-react"

import {
  readPupilReportAction,
  readLearningObjectivesByUnitAction,
  type LearningObjectiveWithCriteria,
} from "@/lib/server-updates"

type SuccessCriterion = LearningObjectiveWithCriteria["success_criteria"][number]

export default async function PupilReportPage({
  params,
}: {
  params: Promise<{ pupilId: string }>
}) {
  const { pupilId } = await params

  const reportResult = await readPupilReportAction(pupilId)

  if (reportResult.error) {
    throw new Error(reportResult.error)
  }

  const report = reportResult.data

  if (!report) {
    notFound()
  }

  const profileName = (() => {
    const first = report.profile?.first_name?.trim() ?? ""
    const last = report.profile?.last_name?.trim() ?? ""
    const combined = `${first} ${last}`.trim()
    return combined.length > 0 ? combined : pupilId
  })()

  const membershipByGroupId = new Map(report.memberships.map((membership) => [membership.group_id, membership]))

  const assignmentsByUnit = new Map<string, {
    unitTitle: string
    unitSubject: string | null
    unitDescription: string | null
    assignments: typeof report.assignments
  }>()

  for (const assignment of report.assignments) {
    const meta = assignment.unit
    const unitTitle = meta?.title ?? assignment.unit_id
    const unitSubject = meta?.subject ?? null
    const unitDescription = meta?.description ?? null
    const existing = assignmentsByUnit.get(assignment.unit_id)
    if (existing) {
      existing.assignments.push(assignment)
    } else {
      assignmentsByUnit.set(assignment.unit_id, {
        unitTitle,
        unitSubject,
        unitDescription,
        assignments: [assignment],
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
      latestFeedbackByCriterion.set(entry.success_criteria_id, { rating: entry.rating, id: entry.id })
    }
  }

  const unitsBySubject = new Map<
    string,
  Array<{
    unitId: string
    unitTitle: string
    unitSubject: string | null
    unitDescription: string | null
    relatedGroups: string[]
    objectiveError: string | null | undefined
    groupedLevels: Array<{
        level: number
        rows: Array<{
          level: number
          assessmentObjectiveCode: string
          assessmentObjectiveTitle: string | null
          objectiveTitle: string
          criterion: SuccessCriterion
        }>
      }>
    workingLevel: number | null
    }>
  >()

  for (const [unitId, summary] of assignmentsByUnit.entries()) {
    const objectivesResult = objectivesByUnit.get(unitId)
    const objectives = objectivesResult?.data ?? []
    const objectiveError = objectivesResult?.error
    const relatedGroups = summary.assignments.map((assignment) => membershipByGroupId.get(assignment.group_id)?.group_id ?? assignment.group_id)
    const assignedUnitIds = new Set(summary.assignments.map((assignment) => assignment.unit_id))

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
          criterion,
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
        const positive = levelRows.filter((row) => (latestFeedbackByCriterion.get(row.criterion.success_criteria_id)?.rating ?? 0) > 0).length
        if (total > 0 && positive / total > 0.5) {
          candidate = level
        }
      })
      return candidate
    })()

    const subjectKey = summary.unitSubject ?? "Subject not set"
    const existingUnits = unitsBySubject.get(subjectKey) ?? []
    existingUnits.push({
      unitId,
      unitTitle: summary.unitTitle,
      unitSubject: summary.unitSubject,
      unitDescription: summary.unitDescription,
      relatedGroups: Array.from(new Set(relatedGroups)),
      objectiveError,
      groupedLevels,
      workingLevel,
    })
    unitsBySubject.set(subjectKey, existingUnits)
  }

  const subjectEntries = Array.from(unitsBySubject.entries())

  const renderFeedbackIndicator = (criterionId: string) => {
    const feedback = latestFeedbackByCriterion.get(criterionId)
    if (!feedback) {
      return (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Minus className="h-4 w-4" />
          No feedback
        </span>
      )
    }

    if (feedback.rating > 0) {
      return (
        <span className="inline-flex items-center gap-2 text-xs text-emerald-600">
          <ThumbsUp className="h-4 w-4" />
          Positive feedback
        </span>
      )
    }

    if (feedback.rating < 0) {
      return (
        <span className="inline-flex items-center gap-2 text-xs text-destructive">
          <ThumbsDown className="h-4 w-4" />
          Needs attention
        </span>
      )
    }

    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Minus className="h-4 w-4" />
        No feedback
      </span>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10">
      <div className="text-sm text-muted-foreground">
        <Link href="/assignments" className="underline-offset-4 hover:underline">
          ← Back to assignments
        </Link>
      </div>

      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
        <div className="flex items-center justify-between">
        <p className="text-sm uppercase tracking-wide text-slate-300">Pupil Report</p>
        <h1 className="text-3xl font-semibold text-white">{profileName}</h1>
            </div>
        </div>
        </div>
      </header>
        

      <section className="space-y-6">
        {subjectEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units assigned yet.</p>
        ) : (
          subjectEntries.map(([subject, units]) => {
            const subjectWorkingLevel = (() => {
              const freq = new Map<number, number>()
              units.forEach((unit) => {
                if (unit.workingLevel != null) {
                  freq.set(unit.workingLevel, (freq.get(unit.workingLevel) ?? 0) + 1)
                }
              })
              if (freq.size === 0) return null
              let bestLevel: number | null = null
              let bestCount = 0
              for (const [level, count] of freq.entries()) {
                if (count > bestCount || (count === bestCount && level > (bestLevel ?? -Infinity))) {
                  bestCount = count
                  bestLevel = level
                }
              }
              return bestLevel
            })()

            const renderUnitTable = (groupedLevels: typeof units[number]["groupedLevels"]) => (
              <div className="mt-6 overflow-auto rounded-lg border border-border">
                <table className="min-w-full border-collapse">
                  <thead className="bg-muted">
                    <tr className="text-left text-sm font-semibold">
                      <th className="border border-border px-4 py-2">Level</th>
                      <th className="border border-border px-4 py-2">Assessment Objective</th>
                      <th className="border border-border px-4 py-2">Learning Objective</th>
                      <th className="border border-border px-4 py-2">Success Criterion</th>
                      <th className="border border-border px-4 py-2">Feedback</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {groupedLevels.flatMap(({ level, rows }) => {
                      const aoGroups = new Map<
                        string,
                        {
                          details: (typeof rows)[number]
                          rowsByObjective: Map<string, typeof rows>
                          rowCount: number
                        }
                      >()

                      rows.forEach((row) => {
                        const aoKey = `${row.assessmentObjectiveCode ?? ""}__${row.assessmentObjectiveTitle ?? ""}`
                        if (!aoGroups.has(aoKey)) {
                          aoGroups.set(aoKey, {
                            details: row,
                            rowsByObjective: new Map(),
                            rowCount: 0,
                          })
                        }
                        const aoEntry = aoGroups.get(aoKey)!
                        const loKey = row.objectiveTitle ?? ""
                        const loRows = aoEntry.rowsByObjective.get(loKey) ?? []
                        loRows.push(row)
                        aoEntry.rowsByObjective.set(loKey, loRows)
                        aoEntry.rowCount += 1
                      })

                      let levelCellRendered = false

                      return Array.from(aoGroups.entries()).flatMap(([aoKey, aoEntry]) =>
                        Array.from(aoEntry.rowsByObjective.entries()).flatMap(([loKey, loRows], loIndex) =>
                          loRows.map((row, scIndex) => {
                            const renderLevelCell = !levelCellRendered
                            const renderAOCel = loIndex === 0 && scIndex === 0
                            const renderLOCel = scIndex === 0

                            if (renderLevelCell) {
                              levelCellRendered = true
                            }

                            return (
                              <tr key={`${row.criterion.success_criteria_id}-${level}-${aoKey}-${loKey}-${scIndex}`}>
                                {renderLevelCell ? (
                                  <td className="border border-border px-4 py-2 align-top" rowSpan={rows.length}>
                                    <span className="font-semibold text-foreground">Level {level}</span>
                                  </td>
                                ) : null}
                                {renderAOCel ? (
                                  <td className="border border-border px-4 py-2 align-top" rowSpan={aoEntry.rowCount}>
                                    <div className="flex flex-col">
                                      <span className="font-medium text-foreground">{row.assessmentObjectiveCode}</span>
                                      {row.assessmentObjectiveTitle ? (
                                        <span className="text-xs text-muted-foreground">{row.assessmentObjectiveTitle}</span>
                                      ) : null}
                                    </div>
                                  </td>
                                ) : null}
                                {renderLOCel ? (
                                  <td className="border border-border px-4 py-2 align-top" rowSpan={loRows.length}>
                                    {row.objectiveTitle}
                                  </td>
                                ) : null}
                                <td className="border border-border px-4 py-2 align-top">
                                  {row.criterion.description}
                                </td>
                                <td className="border border-border px-4 py-2 align-top">
                                  {renderFeedbackIndicator(row.criterion.success_criteria_id)}
                                </td>
                              </tr>
                            )
                          }),
                        ),
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )

            return (
              <details key={subject} className="space-y-4 rounded-lg border border-border bg-card p-4">
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-foreground">
                  <span>{subject}</span>
                  <span className="text-sm text-muted-foreground">
                    Working at: <span className="text-base font-semibold text-foreground">{subjectWorkingLevel ? `Level ${subjectWorkingLevel}` : "Not established"}</span>
                  </span>
                </summary>

                <div className="space-y-6">
                  {units.map((unit) => (
                    <article key={unit.unitId} className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
                      <header className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-semibold text-foreground">{unit.unitTitle}</h4>
                          <p className="text-xs text-muted-foreground">
                            {unit.unitDescription ?? "No description available."}
                          </p>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          Working at: <span className="text-lg font-semibold text-foreground">{unit.workingLevel ? `Level ${unit.workingLevel}` : "Not established"}</span>
                        </span>
                      </header>

                      {unit.objectiveError ? (
                        <p className="text-sm text-destructive">Unable to load learning objectives: {unit.objectiveError}</p>
                      ) : unit.groupedLevels.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No success criteria are assigned to this group for the current units.</p>
                      ) : (
                        renderUnitTable(unit.groupedLevels)
                      )}
                    </article>
                  ))}
                </div>
              </details>
            )
          })
        )}
      </section>

      <footer className="mt-12 text-[10px] text-muted-foreground">Pupil ID: {pupilId}</footer>
    </main>
  )
}
