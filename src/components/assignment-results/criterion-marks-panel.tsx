"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import {
  readSubmissionScMarksAction,
  updateScMarkAction,
  type ScMarkRow,
} from "@/lib/server-actions/sc-marks"

interface CriterionMarksPanelProps {
  submissionId: string
  /** Called after an override so the caller can refresh its own totals. */
  onAggregateChange?: (aggregate: { awarded: number; available: number } | null) => void
}

/**
 * Per-criterion breakdown for one submission: marks, the descriptor achieved,
 * and the model's comment for that criterion.
 *
 * Teachers edit an individual criterion here; the submission total is the sum
 * of its criteria (Q7), so there is no separate whole-activity override. An
 * edited criterion is stamped `teacher` and survives a re-mark.
 */
export function CriterionMarksPanel({ submissionId, onAggregateChange }: CriterionMarksPanelProps) {
  const [marks, setMarks] = useState<ScMarkRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  const load = useCallback(async () => {
    setLoading(true)
    const result = await readSubmissionScMarksAction(submissionId)
    setMarks(result.data ?? [])
    setLoading(false)
  }, [submissionId])

  useEffect(() => {
    void load()
  }, [load])

  const setAwarded = (successCriteriaId: string, awarded: number) => {
    startTransition(async () => {
      const result = await updateScMarkAction({ submissionId, successCriteriaId, awarded })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setMarks((prev) =>
        prev
          ? prev.map((mark) =>
              mark.success_criteria_id === successCriteriaId
                ? { ...mark, awarded, provenance: "teacher" as const }
                : mark,
            )
          : prev,
      )
      const aggregate = result.data?.aggregate ?? null
      onAggregateChange?.(
        aggregate ? { awarded: aggregate.awarded, available: aggregate.available } : null,
      )
      toast.success("Criterion mark updated.")
    })
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading criteria…</p>
  }

  if (!marks || marks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No success criteria are linked to this activity.
      </p>
    )
  }

  const totalAwarded = marks.reduce((sum, mark) => sum + mark.awarded, 0)
  const totalAvailable = marks.reduce((sum, mark) => sum + mark.available, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-foreground">Success criteria</h4>
        <span className="text-sm font-medium text-foreground">
          {totalAwarded} / {totalAvailable}
        </span>
      </div>

      <ul className="space-y-3">
        {marks.map((mark) => (
          <li key={mark.success_criteria_id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="flex-1 text-sm text-foreground">{mark.description}</p>
              <div className="flex shrink-0 items-center gap-2">
                {mark.provenance === "teacher" ? (
                  <Badge variant="secondary" className="text-[10px]">Teacher</Badge>
                ) : null}
                {mark.provenance === "legacy" ? (
                  <Badge variant="outline" className="text-[10px]" title="Migrated from before per-criterion marking; derived, not a real assessment.">
                    Legacy
                  </Badge>
                ) : null}
                <span className="text-sm font-medium text-foreground">
                  {mark.awarded} / {mark.available}
                </span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {Array.from({ length: mark.available + 1 }, (_, level) => {
                const isSelected = mark.awarded === level
                const descriptor = level === 0
                  ? "No descriptor met"
                  : mark.descriptors[level - 1] ?? `Level ${level}`
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={isPending}
                    onClick={() => setAwarded(mark.success_criteria_id, level)}
                    title={mark.sc_type === "levelled" ? descriptor : undefined}
                    className={`rounded border px-2 py-0.5 text-xs transition disabled:opacity-50 ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {level}
                  </button>
                )
              })}
            </div>

            {mark.sc_type === "levelled" && mark.awarded > 0 && mark.descriptors[mark.awarded - 1] ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {mark.descriptors[mark.awarded - 1]}
              </p>
            ) : null}

            {mark.feedback ? (
              <p className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                {mark.feedback}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
