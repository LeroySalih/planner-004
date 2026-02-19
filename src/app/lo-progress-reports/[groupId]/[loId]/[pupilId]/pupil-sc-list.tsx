'use client'

type SuccessCriterion = {
  scId: string
  scTitle: string
  rating: number | null
}

type PupilSCListProps = {
  successCriteria: SuccessCriterion[]
}

function formatPercent(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

function getMetricColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'bg-muted'
  }
  const percent = value * 100
  if (percent < 40) {
    return 'bg-red-100 dark:bg-red-900/30'
  } else if (percent < 70) {
    return 'bg-amber-100 dark:bg-amber-900/30'
  } else {
    return 'bg-green-100 dark:bg-green-900/30'
  }
}

export function PupilSCList({ successCriteria }: PupilSCListProps) {
  if (successCriteria.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          No success criteria data available for this learning objective yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Success Criteria</h2>
        <div className="space-y-3">
          {successCriteria.map((sc) => (
            <div
              key={sc.scId}
              className="flex items-center justify-between rounded-lg border border-border bg-background p-4"
            >
              <div className="flex-1">
                <h3 className="font-medium text-foreground">{sc.scTitle}</h3>
              </div>

              <div className="flex flex-shrink-0 gap-3">
                <div className={`rounded-md px-4 py-3 text-center ${getMetricColor(sc.rating)}`}>
                  <div className="text-2xl font-semibold text-foreground">
                    {formatPercent(sc.rating)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Score:</div>
          <div>Average score per success criterion</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-100 dark:bg-green-900/30"></div>
            <span>≥70%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-amber-100 dark:bg-amber-900/30"></div>
            <span>40-69%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-red-100 dark:bg-red-900/30"></div>
            <span>&lt;40%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
