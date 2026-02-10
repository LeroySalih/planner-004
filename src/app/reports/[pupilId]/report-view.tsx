import Link from "next/link"
import { notFound } from "next/navigation"

import { getPreparedReportData } from "./report-data"

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

export async function PupilReportView({ pupilId, authEndTime }: { pupilId: string; authEndTime?: number }) {
  const prepared = await getPreparedReportData(pupilId, undefined, { authEndTime })

  if (!prepared) {
    notFound()
  }

  const { profileName, formattedDate, subjectEntries } = prepared

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-300">Pupil Report</p>
            <h1 className="text-3xl font-semibold text-white">{profileName}</h1>
          </div>
          <span className="text-xs uppercase tracking-wide text-slate-200">Updated {formattedDate}</span>
        </div>
      </header>

      <section className="space-y-6">
        {subjectEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No units assigned yet.</p>
        ) : (
          subjectEntries.map((subjectEntry) => (
            <article key={subjectEntry.subject} className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-foreground">{subjectEntry.subject}</h2>
                {subjectEntry.workingLevel != null ? (
                  <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">
                    Overall Level {subjectEntry.workingLevel}
                  </span>
                ) : null}
              </header>

              <div className="space-y-3">
                {subjectEntry.units.map((unit) => (
                  <div
                    key={unit.unitId}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 transition hover:border-primary/40"
                  >
                    <div className="flex flex-col gap-2">
                      <Link
                        href={`/reports/${pupilId}/units/${unit.unitId}`}
                        className="text-lg font-semibold text-foreground underline-offset-4 transition hover:text-primary hover:underline"
                      >
                        {unit.unitTitle}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {unit.unitDescription?.trim() || "No description available."}
                      </p>
                    </div>

                    <dl className="grid grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                      <div className="rounded-md bg-muted/60 px-3 py-2">
                        <dt className="text-xs uppercase tracking-wide">Score</dt>
                        <dd className="text-base font-medium text-foreground">{formatPercent(unit.average)}</dd>
                      </div>
                      <div className="rounded-md bg-muted/60 px-3 py-2">
                        <dt className="text-xs uppercase tracking-wide">Level</dt>
                        <dd className="text-base font-medium text-foreground">
                          {formatLevel(unit.assessmentLevel, unit.workingLevel)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>

      <footer className="text-[10px] text-muted-foreground">Pupil ID: {pupilId}</footer>
    </main>
  )
}
