"use client"

import { useEffect, useState } from "react"

import { readMyScMarksForActivityAction } from "@/lib/server-actions/sc-marks"

interface CriterionBreakdownRow {
  success_criteria_id: string
  description: string
  sc_type: "binary" | "levelled"
  descriptors: string[]
  awarded: number
  available: number
  feedback: string | null
}

/**
 * Read-only per-criterion breakdown shown to a pupil: what each criterion was
 * worth, what they scored, which descriptor they reached, and the comment for
 * that criterion specifically (Q11).
 *
 * Only rendered once feedback is released — the caller decides that.
 */
export function CriterionBreakdown({
  activityId,
  pupilId,
  onLoaded,
}: {
  activityId: string
  pupilId?: string
  /** Reports how many criteria were found, so the caller can avoid showing
   *  the concatenated feedback twice. Called with 0 when there are none. */
  onLoaded?: (count: number) => void
}) {
  const [rows, setRows] = useState<CriterionBreakdownRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void readMyScMarksForActivityAction(activityId, pupilId).then((result) => {
      if (cancelled) return
      const next = (result.data as CriterionBreakdownRow[] | null) ?? []
      setRows(next)
      onLoaded?.(next.length)
    })
    return () => {
      cancelled = true
    }
  }, [activityId, pupilId, onLoaded])

  if (!rows || rows.length === 0) {
    return null
  }

  const awarded = rows.reduce((sum, row) => sum + row.awarded, 0)
  const available = rows.reduce((sum, row) => sum + row.available, 0)

  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Success criteria
        </p>
        <span className="text-xs font-semibold text-foreground">
          {awarded} / {available}
        </span>
      </div>

      <ul className="mt-2 space-y-2">
        {rows.map((row) => {
          const achieved = row.sc_type === "levelled" && row.awarded > 0
            ? row.descriptors[row.awarded - 1] ?? null
            : null

          return (
            <li key={row.success_criteria_id} className="border-l-2 border-primary/30 pl-2">
              <div className="flex items-start justify-between gap-2">
                <p className="flex-1 text-sm text-foreground">{row.description}</p>
                <span className="shrink-0 text-xs font-semibold text-foreground">
                  {row.awarded} / {row.available}
                </span>
              </div>
              {achieved ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{achieved}</p>
              ) : null}
              {row.feedback ? (
                <p className="mt-1 text-xs text-foreground/80">{row.feedback}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
