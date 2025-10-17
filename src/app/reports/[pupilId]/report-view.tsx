import Link from "next/link"
import { notFound } from "next/navigation"
import { ExportPdfButton } from "./export-pdf-button"
import { getPreparedReportData, type ReportUnitSummary } from "./report-data"

function formatPercent(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—"
  }
  return `${Math.round(value * 100)}%`
}

export async function PupilReportView({
  pupilId,
  groupIdFilter,
  variant = "default",
}: {
  pupilId: string
  groupIdFilter?: string
  variant?: "default" | "print"
}) {
  const prepared = await getPreparedReportData(pupilId, groupIdFilter)

  if (!prepared) {
    notFound()
  }

  const { profileName, formattedDate, exportFileName, primaryMembership, subjectEntries } = prepared

  const printLink = groupIdFilter ? `/reports/${pupilId}/groups/${groupIdFilter}/print` : null
  return (
    <main
      className={
        variant === "print"
          ? "mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8"
          : "mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10"
      }
    >
      <div className="flex flex-col gap-10">
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
                <div className="flex flex-col gap-3">
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
                <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-300">
                  <ExportPdfButton pupilId={pupilId} fileName={exportFileName} groupId={groupIdFilter} />
                  {printLink ? (
                    <Link
                      href={printLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-1 text-white transition hover:bg-white/10"
                    >
                      Print version
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </header>
        )}

        <section className="space-y-6">
          {subjectEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No units assigned yet.</p>
          ) : (
            subjectEntries.map(({ subject, units, workingLevel }, index) => {
              const isLastSubject = index === subjectEntries.length - 1

              const renderUnitTable = (groupedLevels: ReportUnitSummary["groupedLevels"]) => (
              <div className="mt-6 overflow-auto rounded-lg border border-border">
                <table className="min-w-full border-collapse">
                  <thead className="bg-muted">
                    <tr className="text-left text-sm font-semibold">
                      <th className="border border-border px-4 py-2">Level</th>
                      <th className="border border-border px-4 py-2" colSpan={5}>
                        Assessment Objective
                      </th>
                      <th className="border border-border px-4 py-2">Scores</th>
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
                              key={`${aoRowKeyBase}-${loKey}-${row.criterionId}-${scIndex}`}
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
                                {row.criterionDescription ?? "No description provided."}
                              </td>
                              <td className="border border-border px-4 py-2 align-top">
                                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                                  <span>
                                    Total:{" "}
                                    <span className="font-semibold text-foreground">
                                      {formatPercent(row.totalScore)}
                                    </span>
                                  </span>
                                  <span>
                                    Assessment:{" "}
                                    <span className="font-semibold text-foreground">
                                      {formatPercent(row.assessmentScore)}
                                    </span>
                                  </span>
                                </div>
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
                    <header className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <h4 className="text-lg font-semibold text-foreground">
                          <Link href={`/units/${unit.unitId}`} className="underline-offset-4 hover:underline">
                            {unit.unitTitle}
                          </Link>
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {unit.unitDescription ?? "No description available."}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground sm:text-sm">
                          <span>
                            Total:{" "}
                            <span className="font-semibold text-foreground">{formatPercent(unit.totalAverage)}</span>
                          </span>
                          <span>
                            Assessment:{" "}
                            <span className="font-semibold text-foreground">
                              {formatPercent(unit.summativeAverage)}
                            </span>
                          </span>
                          {unit.relatedGroups.length > 0 ? (
                            <span>
                              Groups:{" "}
                              <span className="font-medium text-foreground">
                                {unit.relatedGroups.join(", ")}
                              </span>
                            </span>
                          ) : null}
                        </div>
                        {unit.scoreError ? (
                          <p className="text-xs text-destructive">
                            Unable to load recent scores: {unit.scoreError}
                          </p>
                        ) : null}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        Working at:{" "}
                        <span className="text-lg font-semibold text-foreground">
                          {unit.workingLevel ? `Level ${unit.workingLevel}` : "Not established"}
                        </span>
                      </span>
                    </header>

                    {unit.objectiveError ? (
                      <p className="text-sm text-destructive">Unable to load learning objectives: {unit.objectiveError}</p>
                    ) : variant === "print" ? (
                      unit.groupedLevels.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No success criteria are assigned to this group for the current units.
                        </p>
                      ) : (
                        renderUnitTable(unit.groupedLevels)
                      )
                    ) : unit.groupedLevels.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No success criteria are assigned to this group for the current units.
                      </p>
                    ) : (
                      <details className="rounded-lg border border-dashed border-border bg-muted/10 p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-foreground">
                          Learning objectives & success criteria
                        </summary>
                        <div className="pt-3">{renderUnitTable(unit.groupedLevels)}</div>
                      </details>
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
                      Working at: <span className="font-semibold text-foreground">{workingLevel ? `Level ${workingLevel}` : "Not established"}</span>
                    </span>
                  </header>
                  {unitsContent}
                </section>
              )
            }

            return (
              <details key={subject} open className="space-y-4 rounded-lg border border-border bg-card p-4">
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-foreground">
                  <span>{subject}</span>
                  <span className="text-sm text-muted-foreground">
                    Working at: <span className="text-base font-semibold text-foreground">{workingLevel ? `Level ${workingLevel}` : "Not established"}</span>
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
      </div>
    </main>
  )
}
