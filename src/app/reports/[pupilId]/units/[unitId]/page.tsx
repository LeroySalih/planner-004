import { performance } from "node:perf_hooks"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { getPreparedUnitReport } from "../../report-data"
import { UnitDetailsTabs } from "./unit-details-tabs"

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

function getMetricColor(value: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "bg-muted" // Default neutral color
  }
  const percent = value * 100
  if (percent < 40) {
    return "bg-red-100 dark:bg-red-900/30"
  } else if (percent < 70) {
    return "bg-amber-100 dark:bg-amber-900/30"
  } else {
    return "bg-green-100 dark:bg-green-900/30"
  }
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

  const { profileName, formattedDate, subject, unit, lessons } = unitReport

  const rows = unit.groupedLevels.flatMap((group) =>
    group.rows.map((row) => ({
      ...row,
      level: row.level ?? group.level,
    })),
  )

  // Group rows hierarchically: AO -> LO -> SC
  type AOGroup = {
    aoCode: string
    aoTitle: string
    learningObjectives: Map<string, {
      loTitle: string
      loId: string
      successCriteria: typeof rows
    }>
  }

  const aoMap = new Map<string, AOGroup>()

  for (const row of rows) {
    const aoCode = row.assessmentObjectiveCode ?? "Not set"
    const aoTitle = row.assessmentObjectiveTitle ?? "No title provided"
    const loId = row.learningObjectiveId ?? "unknown"
    const loTitle = row.objectiveTitle

    if (!aoMap.has(aoCode)) {
      aoMap.set(aoCode, {
        aoCode,
        aoTitle,
        learningObjectives: new Map()
      })
    }

    const ao = aoMap.get(aoCode)!
    if (!ao.learningObjectives.has(loId)) {
      ao.learningObjectives.set(loId, {
        loTitle,
        loId,
        successCriteria: []
      })
    }

    ao.learningObjectives.get(loId)!.successCriteria.push(row)
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-4">
        <Link
          href={`/reports/${pupilId}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          ← Back to report
        </Link>
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-6 py-6 text-white shadow-lg sm:px-8">
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
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">{unit.unitTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {unit.unitDescription?.trim() || "No description available."}
            </p>
          </div>
          <dl className="grid w-full grid-cols-1 gap-3 text-sm text-muted-foreground sm:w-auto sm:grid-cols-3">
            <div className={`rounded-md px-3 py-2 text-center ${getMetricColor(unit.activitiesAverage)}`}>
              <div className="text-lg font-semibold text-foreground">
                {formatPercent(unit.activitiesAverage)}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Completion
              </div>
            </div>
            <div className={`rounded-md px-3 py-2 text-center ${getMetricColor(unit.assessmentAverage)}`}>
              <div className="text-lg font-semibold text-foreground">
                {formatPercent(unit.assessmentAverage)}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Assessment
              </div>
            </div>
            <div className="rounded-md bg-muted px-3 py-2 text-center">
              <div className="text-lg font-semibold text-foreground">
                {formatLevel(unit.assessmentLevel, unit.workingLevel)}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Level
              </div>
            </div>
          </dl>
        </header>
        {unit.scoreError ? (
          <p className="text-sm text-destructive">Unable to load recent scores: {unit.scoreError}</p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">Unit Details</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No success criteria are linked to this unit yet.
          </p>
        ) : (
          <UnitDetailsTabs
            loScView={
              <div className="space-y-6 rounded-lg border border-border bg-card p-6">
            {Array.from(aoMap.values()).map((ao) => (
              <div key={ao.aoCode} className="space-y-4">
                {/* Assessment Objective */}
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                  <div className="flex-1 space-y-1">
                    <h4 className="font-semibold text-foreground">
                      {ao.aoCode}: {ao.aoTitle}
                    </h4>
                  </div>
                </div>

                {/* Learning Objectives */}
                <div className="ml-5 space-y-4 border-l-2 border-border pl-6">
                  {Array.from(ao.learningObjectives.values()).map((lo) => {
                    // Aggregate metrics for this LO from its success criteria
                    const scWithScores = lo.successCriteria.filter(sc =>
                      (typeof sc.activitiesScore === 'number' && !Number.isNaN(sc.activitiesScore)) ||
                      (typeof sc.assessmentScore === 'number' && !Number.isNaN(sc.assessmentScore))
                    )

                    const completionScores = lo.successCriteria
                      .map(sc => sc.activitiesScore)
                      .filter((score): score is number => typeof score === 'number' && !Number.isNaN(score))
                    const avgCompletion = completionScores.length > 0
                      ? completionScores.reduce((sum, score) => sum + score, 0) / completionScores.length
                      : null

                    const assessmentScores = lo.successCriteria
                      .map(sc => sc.assessmentScore)
                      .filter((score): score is number => typeof score === 'number' && !Number.isNaN(score))
                    const avgAssessment = assessmentScores.length > 0
                      ? assessmentScores.reduce((sum, score) => sum + score, 0) / assessmentScores.length
                      : null

                    const levels = lo.successCriteria
                      .map(sc => sc.level)
                      .filter((level): level is number => typeof level === 'number')
                    const avgLevel = levels.length > 0
                      ? Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length)
                      : null

                    return (
                      <div key={lo.loId} className="space-y-3">
                        <div className="flex items-center gap-4">
                          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-muted-foreground" />
                          <div className="flex-1">
                            <p className="font-medium text-foreground">{lo.loTitle}</p>
                          </div>
                          <div className="flex flex-shrink-0 gap-2">
                            <div className="rounded-md bg-muted px-2 py-1.5 text-center">
                              <div className="text-base font-semibold text-foreground">
                                {avgLevel ?? "—"}
                              </div>
                              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                Level
                              </div>
                            </div>
                            <div className={`rounded-md px-2 py-1.5 text-center ${getMetricColor(avgCompletion)}`}>
                              <div className="text-base font-semibold text-foreground">
                                {formatPercent(avgCompletion)}
                              </div>
                              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                Completion
                              </div>
                            </div>
                            <div className={`rounded-md px-2 py-1.5 text-center ${getMetricColor(avgAssessment)}`}>
                              <div className="text-base font-semibold text-foreground">
                                {formatPercent(avgAssessment)}
                              </div>
                              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                Assessment
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Success Criteria */}
                        <div className="ml-5 space-y-2 border-l border-border pl-6">
                        {lo.successCriteria.map((sc, index) => (
                          <div
                            key={`${sc.criterionId}-${index}`}
                            className="flex items-center gap-4 rounded-md bg-muted/30 p-3"
                          >
                            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground" />
                            <div className="flex-1">
                              <p className="text-sm text-foreground">{sc.criterionDescription}</p>
                            </div>
                            <div className="flex flex-shrink-0 gap-1.5">
                              <div className="rounded bg-muted px-1.5 py-0.5 text-center">
                                <div className="text-xs font-semibold text-foreground">
                                  {sc.level ?? "—"}
                                </div>
                                <div className="text-[7px] uppercase tracking-wide text-muted-foreground">
                                  Level
                                </div>
                              </div>
                              <div className={`rounded px-1.5 py-0.5 text-center ${getMetricColor(sc.activitiesScore)}`}>
                                <div className="text-xs font-semibold text-foreground">
                                  {formatPercent(sc.activitiesScore)}
                                </div>
                                <div className="text-[7px] uppercase tracking-wide text-muted-foreground">
                                  Completion
                                </div>
                              </div>
                              <div className={`rounded px-1.5 py-0.5 text-center ${getMetricColor(sc.assessmentScore)}`}>
                                <div className="text-xs font-semibold text-foreground">
                                  {formatPercent(sc.assessmentScore)}
                                </div>
                                <div className="text-[7px] uppercase tracking-wide text-muted-foreground">
                                  Assessment
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
            }
            lessonActivityView={
              <div className="rounded-lg border border-border bg-card p-6">
                <div className="space-y-3">
                  {lessons.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No lessons found for this unit.
                    </p>
                  ) : (
                    lessons.map((lesson) => (
                      <div key={lesson.lesson_id} className="flex items-center justify-between rounded-md bg-muted/30 p-4">
                        <h4 className="flex-1 font-medium text-foreground">{lesson.title}</h4>
                        {lesson.scoreAverages && (
                          <div className="flex flex-shrink-0 gap-2">
                            <div className={`rounded px-2 py-1 text-center ${getMetricColor(lesson.scoreAverages.activitiesAverage)}`}>
                              <div className="text-xs font-semibold text-foreground">{formatPercent(lesson.scoreAverages.activitiesAverage)}</div>
                              <div className="text-[7px] uppercase tracking-wide text-muted-foreground">Completion</div>
                            </div>
                            <div className={`rounded px-2 py-1 text-center ${getMetricColor(lesson.scoreAverages.assessmentAverage)}`}>
                              <div className="text-xs font-semibold text-foreground">{formatPercent(lesson.scoreAverages.assessmentAverage)}</div>
                              <div className="text-[7px] uppercase tracking-wide text-muted-foreground">Assessment</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            }
          />
        )}
      </section>
    </main>
  )
}
