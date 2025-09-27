import Link from "next/link"
import { notFound } from "next/navigation"
import { Minus, ThumbsDown, ThumbsUp } from "lucide-react"

import {
  readPupilReportAction,
  readLearningObjectivesByUnitAction,
  type LearningObjectiveWithCriteria,
} from "@/lib/server-updates"

type SuccessCriterion = LearningObjectiveWithCriteria["success_criteria"][number]

export async function PupilReportView({
  pupilId,
  groupIdFilter,
  variant = "default",
}: {
  pupilId: string
  groupIdFilter?: string
  variant?: "default" | "print"
}) {
  const reportResult = await readPupilReportAction(pupilId)

  if (reportResult.error && !reportResult.data) {
    throw new Error(reportResult.error)
  }

  const report = reportResult.data

  if (!report) {
    notFound()
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

  const formattedDate = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date())

  const assignmentsByUnit = new Map<
    string,
    {
      unitTitle: string
      unitSubject: string | null
      unitDescription: string | null
      assignments: typeof assignments
    }
  >()

  for (const assignment of assignments) {
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

  const backLink = groupIdFilter ? `/reports/${pupilId}` : "/assignments"
  const backLabel = groupIdFilter ? "← Back to full report" : "← Back to assignments"
  const printLink = groupIdFilter ? `/reports/${pupilId}/groups/${groupIdFilter}/print` : null

  return (
    <main
      className={
        variant === "print"
          ? "mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8"
          : "mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10"
      }
    >
      {variant === "default" ? (
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <Link href={backLink} className="underline-offset-4 hover:underline">
            {backLabel}
          </Link>
          {printLink ? (
            <Link
              href={printLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              Print version
            </Link>
          ) : null}
        </div>
      ) : null}

      {variant === "print" ? (
        <header className="flex flex-col gap-1 border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold text-foreground">{profileName}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {groupIdFilter ? (
                <span>
                  <strong>Group:</strong> {groupIdFilter}
                </span>
              ) : null}
              {groupIdFilter ? (
                <span>
                  <strong>Subject:</strong> {primaryMembership?.group?.subject ?? "Not set"}
                </span>
              ) : null}
              <span>{formattedDate}</span>
            </div>
          </div>
        </header>
      ) : (
        <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-wide text-slate-300">Pupil Report</p>
                <h1 className="text-3xl font-semibold text-white">{profileName}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-300">
                {groupIdFilter ? (
                  <span className="rounded-full border border-white/20 px-3 py-1 text-white">
                    Group {groupIdFilter}
                  </span>
                ) : null}
                {groupIdFilter ? (
                  <span className="rounded-full border border-white/20 px-3 py-1 text-white">
                    Subject: {primaryMembership?.group?.subject ?? "Not set"}
                  </span>
                ) : null}
                <span className="rounded-full border border-white/20 px-3 py-1 text-white">{formattedDate}</span>
              </div>
            </div>
          </div>
        </header>
      )}

      <section className="space-y-6">
        {subjectEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units assigned yet.</p>
        ) : (
          subjectEntries.map(([subject, units], index) => {
            const isLastSubject = index === subjectEntries.length - 1
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
                      <th className="border border-border px-4 py-2" colSpan={5}>
                        Assessment Objective
                      </th>
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
                        }
                      >()

                      rows.forEach((row) => {
                        const aoKey = `${row.assessmentObjectiveCode ?? ""}__${row.assessmentObjectiveTitle ?? ""}`
                        if (!aoGroups.has(aoKey)) {
                          aoGroups.set(aoKey, {
                            details: row,
                            rowsByObjective: new Map(),
                          })
                        }
                        const aoEntry = aoGroups.get(aoKey)!
                        const loKey = row.objectiveTitle ?? ""
                        const loRows = aoEntry.rowsByObjective.get(loKey) ?? []
                        loRows.push(row)
                        aoEntry.rowsByObjective.set(loKey, loRows)
                      })

                      const aoEntries = Array.from(aoGroups.entries())
                      const levelRowSpan = aoEntries.reduce((acc, [, aoEntry]) => {
                        const loEntries = Array.from(aoEntry.rowsByObjective.entries())
                        const scCount = loEntries.reduce((sum, [, loRows]) => sum + loRows.length, 0)
                        return acc + 1 + scCount
                      }, 0)

                      let levelCellInserted = false

                      return aoEntries.flatMap(([aoKey, aoEntry]) => {
                        const aoDetails = aoEntry.details
                        const loEntries = Array.from(aoEntry.rowsByObjective.entries())
                        const aoRowKeyBase = `${level}-${aoKey}`

                        const aoHeaderRow = (
                          <tr key={`${aoRowKeyBase}-header`}>
                            {!levelCellInserted ? (
                              <td className="border border-border px-4 py-2 align-top" rowSpan={levelRowSpan}>
                                <span className="font-semibold text-foreground">Level {level}</span>
                              </td>
                            ) : null}
                            <td className="border border-border px-4 py-3 align-top" colSpan={5}>
                              <div className="flex flex-col gap-1">
                                <span className="text-sm font-semibold text-foreground">
                                  {aoDetails.assessmentObjectiveCode ?? "AO"}
                                </span>
                                {aoDetails.assessmentObjectiveTitle ? (
                                  <span className="text-xs text-muted-foreground">
                                    {aoDetails.assessmentObjectiveTitle}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="border border-border px-4 py-2" />
                          </tr>
                        )

                        levelCellInserted = true

                        const loRowsNodes = loEntries.flatMap(([loKey, loRows]) =>
                          loRows.map((row, scIndex) => (
                            <tr
                              key={`${aoRowKeyBase}-${loKey}-${row.criterion.success_criteria_id}-${scIndex}`}
                            >
                              {scIndex === 0 ? (
                                <td
                                  className="border border-border px-4 py-2 align-top font-medium text-foreground"
                                  colSpan={2}
                                  rowSpan={loRows.length}
                                >
                                  {row.objectiveTitle}
                                </td>
                              ) : null}
                              <td className="border border-border px-4 py-2 align-top" colSpan={3}>
                                {row.criterion.description}
                              </td>
                              <td className="border border-border px-4 py-2 align-top">
                                {renderFeedbackIndicator(row.criterion.success_criteria_id)}
                              </td>
                            </tr>
                          )),
                        )

                        return [aoHeaderRow, ...loRowsNodes]
                      })
                    })}
                  </tbody>
                </table>
              </div>
            )

            const unitsContent = (
              <div className="space-y-6">
                {units.map((unit) => (
                  <article
                    key={unit.unitId}
                    className={
                      variant === "print"
                        ? "space-y-3 border-b border-dashed border-border pb-4 last:border-none"
                        : "space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm"
                    }
                  >
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
            )

            if (variant === "print") {
              return (
                <section
                  key={subject}
                  className={`space-y-4 ${isLastSubject ? "" : "print-break-after"}`.trim()}
                >
                  <header className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-foreground">{subject}</h3>
                    <span className="text-sm text-muted-foreground">
                      Working at: <span className="font-semibold text-foreground">{subjectWorkingLevel ? `Level ${subjectWorkingLevel}` : "Not established"}</span>
                    </span>
                  </header>
                  {unitsContent}
                </section>
              )
            }

            return (
              <details key={subject} className="space-y-4 rounded-lg border border-border bg-card p-4">
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-foreground">
                  <span>{subject}</span>
                  <span className="text-sm text-muted-foreground">
                    Working at: <span className="text-base font-semibold text-foreground">{subjectWorkingLevel ? `Level ${subjectWorkingLevel}` : "Not established"}</span>
                  </span>
                </summary>

                {unitsContent}
              </details>
            )
          })
        )}
      </section>

      {variant === "print" ? (
        <footer className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
          Generated on {formattedDate}
        </footer>
      ) : (
        <footer className="mt-12 text-[10px] text-muted-foreground">
          Pupil ID: {pupilId}
          {groupIdFilter ? ` · Group ID: ${groupIdFilter}` : null}
        </footer>
      )}
    </main>
  )
}
