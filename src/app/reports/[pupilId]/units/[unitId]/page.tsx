import { performance } from "node:perf_hooks"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { getPreparedUnitReport } from "../../report-data"

function formatPercent(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—"
  }
  return `${Math.round(value * 100)}%`
}

function formatLevel(assessmentLevel: string | null, workingLevel: number | null) {
  const resolved = assessmentLevel ?? (typeof workingLevel === "number" ? workingLevel.toString() : null)
  return resolved ? `Level ${resolved}` : "—"
}

export default async function UnitReportPage({
  params,
}: {
  params: Promise<{ pupilId: string; unitId: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const authEnd = performance.now()
  const { pupilId, unitId } = await params

  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/reports/${encodeURIComponent(profile.userId)}`)
  }

  const unitReport = await getPreparedUnitReport(pupilId, unitId, { authEndTime: authEnd })
  if (!unitReport) {
    notFound()
  }

  const { profileName, formattedDate, subject, unit } = unitReport

  const rows = unit.groupedLevels.flatMap((group) =>
    group.rows.map((row) => ({
      ...row,
      level: row.level ?? group.level,
    })),
  )

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="space-y-4">
        <Link
          href={`/reports/${pupilId}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          ← Back to report
        </Link>
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-wide text-slate-300">Pupil Report</p>
            <h1 className="text-3xl font-semibold text-white">{profileName}</h1>
            <div className="flex flex-wrap gap-3 text-xs uppercase tracking-wide text-slate-200">
              <span>{subject}</span>
              <span className="rounded-full border border-white/30 px-3 py-1">Updated {formattedDate}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">{unit.unitTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {unit.unitDescription?.trim() || "No description available."}
            </p>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="rounded-md bg-muted/60 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide">Activities</dt>
              <dd className="text-base font-medium text-foreground">{formatPercent(unit.activitiesAverage)}</dd>
            </div>
            <div className="rounded-md bg-muted/60 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide">Assessment</dt>
              <dd className="text-base font-medium text-foreground">{formatPercent(unit.assessmentAverage)}</dd>
            </div>
            <div className="rounded-md bg-muted/60 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide">Level</dt>
              <dd className="text-base font-medium text-foreground">
                {formatLevel(unit.assessmentLevel, unit.workingLevel)}
              </dd>
            </div>
          </dl>
        </header>
        {unit.scoreError ? (
          <p className="text-sm text-destructive">Unable to load recent scores: {unit.scoreError}</p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">Learning objectives & success criteria</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No success criteria are linked to this unit yet.
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="border border-border px-4 py-3 text-left">Level</th>
                  <th className="border border-border px-4 py-3 text-left">Assessment Objective</th>
                  <th className="border border-border px-4 py-3 text-left">Learning Objective</th>
                  <th className="border border-border px-4 py-3 text-left">Success Criteria</th>
                  <th className="border border-border px-4 py-3 text-left">Activities %</th>
                  <th className="border border-border px-4 py-3 text-left">Assessment %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.criterionId}-${row.level}-${index}`}>
                    <td className="border border-border px-4 py-2 align-top text-muted-foreground">
                      {row.level ?? "—"}
                    </td>
                    <td className="border border-border px-4 py-2 align-top text-muted-foreground">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {row.assessmentObjectiveCode ?? "Not set"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {row.assessmentObjectiveTitle ?? "No title provided"}
                        </span>
                      </div>
                    </td>
                    <td className="border border-border px-4 py-2 align-top text-foreground">{row.objectiveTitle}</td>
                    <td className="border border-border px-4 py-2 align-top text-muted-foreground">
                      {row.criterionDescription}
                    </td>
                    <td className="border border-border px-4 py-2 align-top text-foreground">
                      {formatPercent(row.activitiesScore)}
                    </td>
                    <td className="border border-border px-4 py-2 align-top text-foreground">
                      {formatPercent(row.assessmentScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
