'use client'

type LOSCData = {
  loId: string
  loTitle: string
  aoTitle: string
  scId: string | null
  scDescription: string | null
  rating: number | null
}

type PupilLOSCListProps = {
  data: LOSCData[]
}

function formatPercent(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

function getScoreBgColor(value: number | null): string {
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

type LOGroup = {
  loId: string
  loTitle: string
  aoTitle: string
  successCriteria: {
    scId: string
    scDescription: string
    rating: number | null
  }[]
}

export function PupilLOSCList({ data }: PupilLOSCListProps) {
  // Group by LO
  const loMap = new Map<string, LOGroup>()

  for (const row of data) {
    if (!loMap.has(row.loId)) {
      loMap.set(row.loId, {
        loId: row.loId,
        loTitle: row.loTitle,
        aoTitle: row.aoTitle,
        successCriteria: []
      })
    }
    if (row.scId && row.scDescription) {
      const lo = loMap.get(row.loId)!
      if (!lo.successCriteria.some(sc => sc.scId === row.scId)) {
        lo.successCriteria.push({
          scId: row.scId,
          scDescription: row.scDescription,
          rating: row.rating,
        })
      }
    }
  }

  const los = Array.from(loMap.values())

  if (los.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          No learning objective data available for this pupil and unit yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {los.map((lo) => (
        <div key={lo.loId} className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <div className="text-xs text-muted-foreground">{lo.aoTitle}</div>
            <h3 className="text-sm font-semibold text-foreground">{lo.loTitle}</h3>
          </div>
          {lo.successCriteria.length > 0 ? (
            <div className="divide-y divide-border">
              {lo.successCriteria.map((sc) => (
                <div
                  key={sc.scId}
                  className="flex items-center justify-between px-6 py-3"
                >
                  <div className="flex-1 text-sm text-foreground">
                    {sc.scDescription}
                  </div>
                  <div className={`ml-4 flex-shrink-0 rounded-md px-4 py-2 text-center ${getScoreBgColor(sc.rating)}`}>
                    <div className="text-lg font-semibold text-foreground">
                      {formatPercent(sc.rating)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-6 py-3">
              <p className="text-sm text-muted-foreground">No success criteria defined.</p>
            </div>
          )}
        </div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-100 dark:bg-green-900/30"></div>
            <span>&ge;70%</span>
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
