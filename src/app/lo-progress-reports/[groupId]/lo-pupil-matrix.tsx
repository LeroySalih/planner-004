'use client'

import Link from 'next/link'

type LOPupilMatrixData = {
  loId: string
  loTitle: string
  aoTitle: string
  pupilId: string
  pupilName: string
  avgRating: number | null
}

type LOPupilMatrixProps = {
  groupId: string
  data: LOPupilMatrixData[]
}

type MatrixStructure = {
  pupils: { pupilId: string; pupilName: string }[]
  learningObjectives: {
    loId: string
    loTitle: string
    aoTitle: string
    pupilMetrics: Map<string, {
      avgRating: number | null
    }>
  }[]
}

function formatPercent(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

function getMetricColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'text-muted-foreground'
  }
  const percent = value * 100
  if (percent < 40) {
    return 'text-red-600 dark:text-red-400'
  } else if (percent < 70) {
    return 'text-amber-600 dark:text-amber-400'
  } else {
    return 'text-green-600 dark:text-green-400'
  }
}

function getCellBgColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'bg-muted/30'
  }
  const percent = value * 100
  if (percent < 40) {
    return 'bg-red-50 dark:bg-red-900/20'
  } else if (percent < 70) {
    return 'bg-amber-50 dark:bg-amber-900/20'
  } else {
    return 'bg-green-50 dark:bg-green-900/20'
  }
}

export function LOPupilMatrix({ groupId, data }: LOPupilMatrixProps) {
  // Build matrix structure
  const matrix: MatrixStructure = {
    pupils: [],
    learningObjectives: []
  }

  const pupilMap = new Map<string, { pupilId: string; pupilName: string }>()
  const loMap = new Map<string, {
    loId: string
    loTitle: string
    aoTitle: string
    pupilMetrics: Map<string, {
      avgRating: number | null
    }>
  }>()

  for (const row of data) {
    // Track pupils
    if (!pupilMap.has(row.pupilId)) {
      pupilMap.set(row.pupilId, {
        pupilId: row.pupilId,
        pupilName: row.pupilName
      })
    }

    // Track learning objectives and metrics
    if (!loMap.has(row.loId)) {
      loMap.set(row.loId, {
        loId: row.loId,
        loTitle: row.loTitle,
        aoTitle: row.aoTitle,
        pupilMetrics: new Map()
      })
    }

    const loEntry = loMap.get(row.loId)!
    loEntry.pupilMetrics.set(row.pupilId, {
      avgRating: row.avgRating
    })
  }

  matrix.pupils = Array.from(pupilMap.values()).sort((a, b) =>
    a.pupilName.localeCompare(b.pupilName)
  )
  matrix.learningObjectives = Array.from(loMap.values())

  if (matrix.pupils.length === 0 || matrix.learningObjectives.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          No progress data available for this class yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-sm font-semibold text-foreground">
                Learning Objective
              </th>
              {matrix.pupils.map((pupil) => (
                <th
                  key={pupil.pupilId}
                  className="px-3 py-3 text-center text-sm font-semibold text-foreground"
                >
                  <div className="min-w-[80px]">
                    {pupil.pupilName}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.learningObjectives.map((lo) => (
              <tr key={lo.loId} className="border-b border-border last:border-b-0">
                <td className="sticky left-0 z-10 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">{lo.aoTitle}</div>
                  <div className="text-sm font-medium text-foreground">{lo.loTitle}</div>
                </td>
                {matrix.pupils.map((pupil) => {
                  const metrics = lo.pupilMetrics.get(pupil.pupilId)
                  if (!metrics) {
                    return (
                      <td
                        key={pupil.pupilId}
                        className="px-3 py-3 text-center text-xs text-muted-foreground"
                      >
                        —
                      </td>
                    )
                  }

                  return (
                    <td
                      key={pupil.pupilId}
                      className={`px-3 py-3 ${getCellBgColor(metrics.avgRating)}`}
                    >
                      <Link
                        href={`/lo-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(lo.loId)}/${encodeURIComponent(pupil.pupilId)}`}
                        className="block"
                      >
                        <div className="flex flex-col items-center gap-1 hover:opacity-80 transition-opacity">
                          <div className={`text-sm font-semibold ${getMetricColor(metrics.avgRating)}`}>
                            {formatPercent(metrics.avgRating)}
                          </div>
                        </div>
                      </Link>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Score:</div>
          <div>Average success criteria score</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-600"></div>
            <span>≥70%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-amber-600"></div>
            <span>40-69%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-red-600"></div>
            <span>&lt;40%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
