"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AssignmentResultActivity,
  AssignmentResultActivitySummary,
  AssignmentResultCell,
  AssignmentResultMatrix,
  AssignmentResultRow,
  AssignmentResultSuccessCriterionSummary,
} from "@/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  overrideAssignmentScoreAction,
  resetAssignmentScoreAction,
} from "@/lib/server-updates"
import { resolveScoreTone } from "@/lib/results/colors"

type CellStatus = AssignmentResultCell["status"]

type CellSelection = {
  rowIndex: number
  activityIndex: number
  row: AssignmentResultRow
  activity: AssignmentResultActivity
  cell: AssignmentResultCell
}

type MatrixWithState = AssignmentResultMatrix & {
  rows: AssignmentResultRow[]
}

function formatPercent(score: number | null): string {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "—"
  }
  return `${Math.round(score * 100)}%`
}

function describeStatus(status: CellStatus) {
  switch (status) {
    case "override":
      return "Override applied"
    case "auto":
      return "Auto score"
    default:
      return "Not marked"
  }
}

function recalculateMatrix(
  activities: AssignmentResultActivity[],
  rows: AssignmentResultRow[],
): {
  rows: AssignmentResultRow[]
  activitySummaries: AssignmentResultActivitySummary[]
  successCriteriaSummaries: AssignmentResultSuccessCriterionSummary[]
  overallAverage: number | null
} {
  const totals = new Map<
    string,
    {
      total: number
      count: number
      submittedCount: number
    }
  >()

  activities.forEach((activity) => {
    totals.set(activity.activityId, {
      total: 0,
      count: 0,
      submittedCount: 0,
    })
  })

  const nextRows = rows.map((row) => {
    const nextCells = row.cells.map((cell) => {
      const slot = totals.get(cell.activityId)
      if (slot) {
        if (typeof cell.score === "number" && Number.isFinite(cell.score)) {
          slot.total += cell.score
          slot.submittedCount += 1
        } else {
          slot.total += 0
        }
        slot.count += 1
        if (cell.status !== "missing" || typeof cell.score === "number") {
          // submittedCount already incremented above when score exists; ensure manual submissions with missing status do not double count
        }
      }
      return cell
    })

    const activityCount = activities.length
    const totalScore = nextCells.reduce(
      (acc, cell) => acc + (typeof cell.score === "number" ? cell.score : 0),
      0,
    )
    const averageScore = activityCount > 0 ? totalScore / activityCount : null

    return { ...row, cells: nextCells, averageScore }
  })

  let overallTotal = 0
  let overallCount = 0

  const activitySummaries: AssignmentResultActivitySummary[] = activities.map((activity) => {
    const entry = totals.get(activity.activityId) ?? { total: 0, count: 0, submittedCount: 0 }
    if (entry.count > 0) {
      overallTotal += entry.total
      overallCount += entry.count
    }
    return {
      activityId: activity.activityId,
      averageScore: entry.count > 0 ? entry.total / entry.count : null,
      submittedCount: entry.submittedCount,
    }
  })

  const successCriteriaTotals = new Map<
    string,
    {
      total: number
      count: number
      submittedCount: number
      activityIds: Set<string>
      title: string | null
      description: string | null
    }
  >()

  for (const activity of activities) {
    const totalsEntry = totals.get(activity.activityId) ?? {
      total: 0,
      count: 0,
      submittedCount: 0,
    }

    for (const criterion of activity.successCriteria) {
      const existing = successCriteriaTotals.get(criterion.successCriteriaId) ?? {
        total: 0,
        count: 0,
        submittedCount: 0,
        activityIds: new Set<string>(),
        title: criterion.title ?? null,
        description: criterion.description ?? null,
      }

      existing.total += totalsEntry.total
      existing.count += totalsEntry.count
      existing.submittedCount += totalsEntry.submittedCount
      existing.activityIds.add(activity.activityId)

      if (!existing.title && criterion.title) {
        existing.title = criterion.title
      }

      if ((!existing.description || existing.description.trim().length === 0) && criterion.description) {
        existing.description = criterion.description
      }

      successCriteriaTotals.set(criterion.successCriteriaId, existing)
    }
  }

  const successCriteriaSummaries: AssignmentResultSuccessCriterionSummary[] = Array.from(
    successCriteriaTotals.entries(),
  ).map(([successCriteriaId, entry]) => ({
    successCriteriaId,
    title: entry.title ?? null,
    description: entry.description ?? null,
    averageScore: entry.count > 0 ? entry.total / entry.count : null,
    submittedCount: entry.submittedCount,
    activityCount: entry.activityIds.size,
  }))

  const overallAverage = overallCount > 0 ? overallTotal / overallCount : null

  return { rows: nextRows, activitySummaries, successCriteriaSummaries, overallAverage }
}

function getSubmissionGuard(cell: AssignmentResultCell) {
  if (!cell.submissionId) {
    return "No submission available to override yet."
  }
  return null
}

export function AssignmentResultsDashboard({ matrix }: { matrix: AssignmentResultMatrix }) {
  const [matrixState, setMatrixState] = useState<MatrixWithState>({ ...matrix, rows: matrix.rows })
  const [selection, setSelection] = useState<CellSelection | null>(null)
  const [isOverridePending, startOverride] = useTransition()
  const [isResetPending, startReset] = useTransition()
  const [scoreDraft, setScoreDraft] = useState<string>("")
  const [feedbackDraft, setFeedbackDraft] = useState<string>("")
  const router = useRouter()

  const activities = matrixState.activities
  const groupedRows = matrixState.rows
  const activitySummariesById = useMemo(() => {
    const map: Record<string, AssignmentResultActivitySummary> = {}
    for (const summary of matrixState.activitySummaries ?? []) {
      map[summary.activityId] = summary
    }
    return map
  }, [matrixState.activitySummaries])
  const successCriteriaSummaries = matrixState.successCriteriaSummaries ?? []
  const pupilsWithoutSubmissions = useMemo(
    () =>
      groupedRows
        .filter((row) => row.cells.every((cell) => !cell.submissionId || cell.status === "missing"))
        .map((row) => row.pupil),
    [groupedRows],
  )

  const overallAverageLabel = useMemo(() => formatPercent(matrixState.overallAverage ?? null), [matrixState.overallAverage])

  const handleCellSelect = (rowIndex: number, activityIndex: number) => {
    const row = groupedRows[rowIndex]
    const activity = activities[activityIndex]
    const cell = row.cells[activityIndex]

    setSelection({
      rowIndex,
      activityIndex,
      row,
      activity,
      cell,
    })

    const initialScore =
      typeof cell.overrideScore === "number" && Number.isFinite(cell.overrideScore)
        ? cell.overrideScore
        : typeof cell.score === "number" && Number.isFinite(cell.score)
          ? cell.score
          : ""
    setScoreDraft(initialScore === "" ? "" : initialScore.toFixed(2))
    setFeedbackDraft(cell.feedback ?? "")
  }

  const closeSheet = () => {
    setSelection(null)
    setScoreDraft("")
    setFeedbackDraft("")
  }

  const applyCellUpdate = (updater: (cell: AssignmentResultCell) => AssignmentResultCell | null) => {
    if (!selection) return

    setMatrixState((previous) => {
      const nextRows = previous.rows.map((row, rowIndex) => {
        if (rowIndex !== selection.rowIndex) {
          return row
        }

        const nextCells = row.cells.map((cell, cellIndex) => {
          if (cellIndex !== selection.activityIndex) {
            return cell
          }
          const updated = updater(cell)
          return updated ?? cell
        })

        return {
          ...row,
          cells: nextCells,
        }
      })

      const recalculated = recalculateMatrix(previous.activities, nextRows)

      return {
        ...previous,
        rows: recalculated.rows,
        activitySummaries: recalculated.activitySummaries,
        successCriteriaSummaries: recalculated.successCriteriaSummaries,
        overallAverage: recalculated.overallAverage,
      }
    })
  }

  const handleOverrideSubmit = () => {
    if (!selection) return

    const trimmedScore = scoreDraft.trim()
    if (trimmedScore.length === 0) {
      toast.error("Enter a score between 0 and 1.")
      return
    }

    const parsedScore = Number.parseFloat(trimmedScore)
    if (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 1) {
      toast.error("Scores must be between 0 and 1.")
      return
    }

    const submissionGuard = getSubmissionGuard(selection.cell)
    if (submissionGuard) {
      toast.error(submissionGuard)
      return
    }

    const feedback = feedbackDraft.trim()

    startOverride(async () => {
      const result = await overrideAssignmentScoreAction({
        assignmentId: matrixState.assignmentId,
        activityId: selection.activity.activityId,
        pupilId: selection.row.pupil.userId,
        submissionId: selection.cell.submissionId,
        score: parsedScore,
        feedback: feedback.length > 0 ? feedback : null,
      })

      if (!result.success) {
        toast.error(result.error ?? "Unable to save override.")
        return
      }

      applyCellUpdate((cell) => ({
        ...cell,
        score: parsedScore,
        overrideScore: parsedScore,
        status: "override",
        feedback: feedback.length > 0 ? feedback : null,
        submittedAt: new Date().toISOString(),
      }))

      setSelection((current) => {
        if (!current) return current
        return {
          ...current,
          cell: {
            ...current.cell,
            score: parsedScore,
            overrideScore: parsedScore,
            status: "override",
            feedback: feedback.length > 0 ? feedback : null,
            submittedAt: new Date().toISOString(),
          },
        }
      })

      toast.success("Override saved.")
    })
  }

  const handleReset = () => {
    if (!selection) return

    const submissionGuard = getSubmissionGuard(selection.cell)
    if (submissionGuard) {
      toast.error(submissionGuard)
      return
    }

    startReset(async () => {
      const result = await resetAssignmentScoreAction({
        assignmentId: matrixState.assignmentId,
        activityId: selection.activity.activityId,
        pupilId: selection.row.pupil.userId,
        submissionId: selection.cell.submissionId,
      })

      if (!result.success) {
        toast.error(result.error ?? "Unable to reset override.")
        return
      }

      applyCellUpdate((cell) => {
        const autoScore = typeof cell.autoScore === "number" ? cell.autoScore : null
        return {
          ...cell,
          score: autoScore,
          overrideScore: null,
          status: typeof autoScore === "number" ? "auto" : "missing",
          feedback: null,
        }
      })

      setSelection((current) => {
        if (!current) return current
        const autoScore =
          typeof current.cell.autoScore === "number" ? current.cell.autoScore : null
        return {
          ...current,
          cell: {
            ...current.cell,
            score: autoScore,
            overrideScore: null,
            status: typeof autoScore === "number" ? "auto" : "missing",
            feedback: null,
          },
        }
      })

      setScoreDraft(
        typeof selection.cell.autoScore === "number" && Number.isFinite(selection.cell.autoScore)
          ? selection.cell.autoScore.toFixed(2)
          : "",
      )
      setFeedbackDraft("")

      toast.success("Override cleared.")
    })
  }

  const goToAssignments = () => {
    router.push("/assignments")
  }

  const goToLesson = () => {
    if (!matrixState.lesson?.lessonId) return
    router.push(`/lessons/${encodeURIComponent(matrixState.lesson.lessonId)}`)
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assignment results</h1>
            <p className="text-sm text-muted-foreground">
              Review pupil performance across all scored activities in this lesson.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={goToAssignments}>
              Back to assignments
            </Button>
            {matrixState.lesson?.lessonId ? (
              <Button variant="outline" onClick={goToLesson}>
                Open lesson
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Assignment context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {matrixState.lesson?.title ?? "Lesson unavailable"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Group {matrixState.group?.groupId ?? "—"}
                  {matrixState.group?.subject ? ` · ${matrixState.group.subject}` : ""}
                </p>
              </div>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="font-medium text-muted-foreground">Group ID:</span>{" "}
                  <span className="text-foreground">{matrixState.group?.groupId ?? "Not available"}</span>
                </p>
                <p>
                  <span className="font-medium text-muted-foreground">Lesson ID:</span>{" "}
                  <span className="text-foreground">{matrixState.lesson?.lessonId ?? "Not available"}</span>
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-col gap-1">
              <CardTitle className="text-sm text-muted-foreground">Score overview</CardTitle>
              <p className="text-xs text-muted-foreground">
                Overall lesson average with linked success criteria summaries.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Overall average</p>
                <p className="text-3xl font-semibold text-foreground">{overallAverageLabel}</p>
              </div>
              <div className="space-y-2">
                {successCriteriaSummaries.length > 0 ? (
                  successCriteriaSummaries.map((summary) => {
                    const label =
                      summary.title?.trim() && summary.title.trim().length > 0
                        ? summary.title.trim()
                        : summary.description?.trim() && summary.description.trim().length > 0
                          ? summary.description.trim()
                          : summary.successCriteriaId
                    return (
                      <div
                        key={summary.successCriteriaId}
                        className="flex items-start justify-between gap-3 rounded-md border border-border/70 px-3 py-2"
                      >
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">
                            {summary.activityCount} activit{summary.activityCount === 1 ? "y" : "ies"} ·{" "}
                            {summary.submittedCount} submission{summary.submittedCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {formatPercent(summary.averageScore ?? null)}
                        </span>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No success criteria links found for the activities in this lesson.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-muted-foreground">Missing submissions</CardTitle>
              <Badge variant="secondary" className="text-xs font-semibold">
                {pupilsWithoutSubmissions.length}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {pupilsWithoutSubmissions.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {pupilsWithoutSubmissions.map((pupil) => (
                    <li
                      key={pupil.userId}
                      className="flex flex-col rounded-md border border-border/60 px-3 py-2"
                    >
                      <span className="font-medium text-foreground">{pupil.displayName}</span>
                      <span className="text-xs text-muted-foreground">{pupil.userId}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">All pupils have submitted answers.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="relative w-full overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-30 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm"
                  >
                    Pupil
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-20 bg-card px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm"
                  >
                    Average
                  </th>
                  {activities.map((activity) => (
                    <th
                      key={activity.activityId}
                      scope="col"
                      className="sticky top-0 z-20 min-w-40 bg-card px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm"
                    >
                      <div className="flex flex-col gap-2 text-left">
                        <div>
                          <span className="block truncate text-sm font-semibold text-foreground">{activity.title}</span>
                          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                            {activity.type.replace(/-/g, " ")}
                          </span>
                        </div>
                        {activity.successCriteria.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {activity.successCriteria.map((criterion) => {
                              const label =
                                criterion.title?.trim() && criterion.title.trim().length > 0
                                  ? criterion.title.trim()
                                  : criterion.description?.trim() && criterion.description.trim().length > 0
                                    ? criterion.description.trim()
                                    : criterion.successCriteriaId
                              return (
                                <span
                                  key={criterion.successCriteriaId}
                                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                >
                                  {label}
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">No linked success criteria</span>
                        )}
                        <span className="text-xs font-semibold text-foreground">
                          {formatPercent(activitySummariesById[activity.activityId]?.averageScore ?? null)}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2 + activities.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      No pupils are currently assigned to this group.
                    </td>
                  </tr>
                ) : (
                  groupedRows.map((row, rowIndex) => (
                    <tr key={row.pupil.userId} className="even:bg-muted/30">
                      <th
                        scope="row"
                        className={cn(
                          "sticky left-0 z-10 bg-background px-4 py-3 text-left text-sm font-semibold text-foreground shadow-[1px_0_0_0_rgba(15,23,42,0.08)]",
                          "whitespace-nowrap",
                        )}
                      >
                        <div className="flex flex-col">
                          <span>{row.pupil.displayName}</span>
                          <span className="text-xs font-normal text-muted-foreground">{row.pupil.userId}</span>
                        </div>
                      </th>
                      <td className="px-3 py-3 text-center font-medium text-foreground">
                        {formatPercent(row.averageScore ?? null)}
                      </td>
                      {row.cells.map((cell, activityIndex) => {
                        const tone = resolveScoreTone(cell.score, cell.status)
                        return (
                          <td key={cell.activityId} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              className={cn(
                                "flex h-10 w-full items-center justify-center rounded-md text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                tone,
                              )}
                              onClick={() => handleCellSelect(rowIndex, activityIndex)}
                            >
                              {formatPercent(cell.score ?? null)}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Sheet open={selection !== null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          {selection ? (
            <>
              <SheetHeader className="px-0">
                <SheetTitle>
                  {selection.activity.title} • {selection.row.pupil.displayName}
                </SheetTitle>
                <SheetDescription>
                  {describeStatus(selection.cell.status)} · Submitted{" "}
                  {selection.cell.submittedAt
                    ? new Date(selection.cell.submittedAt).toLocaleString()
                    : "N/A"}
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-4 px-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Current score</span>
                  <Badge variant={selection.cell.status === "override" ? "default" : "secondary"}>
                    {selection.cell.status === "override" ? "Override" : "Auto"}
                  </Badge>
                </div>
                <div className="text-3xl font-semibold text-foreground">
                  {formatPercent(selection.cell.score ?? null)}
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="override-score">
                    Override score (0–1)
                  </label>
                  <Input
                    id="override-score"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={scoreDraft}
                    onChange={(event) => setScoreDraft(event.target.value)}
                  />
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="override-feedback">
                    Teacher feedback
                  </label>
                  <Textarea
                    id="override-feedback"
                    value={feedbackDraft}
                    placeholder="Optional feedback for the pupil"
                    onChange={(event) => setFeedbackDraft(event.target.value)}
                    rows={4}
                  />
                </div>

                {!selection.cell.submissionId ? (
                  <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    This activity has not recorded a submission for the pupil yet. Save and reset actions are disabled
                    until a submission exists.
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    onClick={handleOverrideSubmit}
                    disabled={isOverridePending || !selection.cell.submissionId}
                  >
                    {isOverridePending ? "Saving…" : "Save override"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={isResetPending || !selection.cell.submissionId}
                  >
                    {isResetPending ? "Resetting…" : "Reset to auto score"}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
