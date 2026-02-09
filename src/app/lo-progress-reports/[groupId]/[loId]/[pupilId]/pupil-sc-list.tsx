'use client'

type SuccessCriterion = {
  scId: string
  scTitle: string
  rating: number | null
}

type PupilSCListProps = {
  successCriteria: SuccessCriterion[]
}

function formatRating(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return value.toFixed(1)
}

function getMetricColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'bg-muted'
  }
  if (value < 2) {
    return 'bg-red-100 dark:bg-red-900/30'
  } else if (value < 3) {
    return 'bg-amber-100 dark:bg-amber-900/30'
  } else {
    return 'bg-green-100 dark:bg-green-900/30'
  }
}

function getRatingLabel(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'Not assessed'
  }
  if (value < 1) return 'Beginning'
  if (value < 2) return 'Developing'
  if (value < 3) return 'Secure'
  if (value < 4) return 'Mastered'
  return 'Exceeded'
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
                    {formatRating(sc.rating)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {getRatingLabel(sc.rating)}
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
          <div className="font-semibold">Scale:</div>
          <div>0 = Beginning, 1 = Developing, 2 = Secure, 3 = Mastered, 4 = Exceeded</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-100 dark:bg-green-900/30"></div>
            <span>≥3.0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-amber-100 dark:bg-amber-900/30"></div>
            <span>2.0-2.9</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-red-100 dark:bg-red-900/30"></div>
            <span>&lt;2.0</span>
          </div>
        </div>
      </div>
    </div>
  )
}
