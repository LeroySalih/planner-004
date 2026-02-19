'use client'

import Link from 'next/link'

type SCPupilMatrixData = {
  scId: string
  scTitle: string
  scOrder: number
  pupilId: string
  pupilName: string
  rating: number | null
}

type LOSCPupilMatrixProps = {
  groupId: string
  loId: string
  data: SCPupilMatrixData[]
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

export function LOSCPupilMatrix({ groupId, loId, data }: LOSCPupilMatrixProps) {
  // Build matrix: pupils as rows, SCs as columns
  const pupilMap = new Map<string, { pupilId: string; pupilName: string }>()
  const scMap = new Map<string, { scId: string; scTitle: string; scOrder: number }>()
  const ratingMap = new Map<string, number | null>() // key: `${pupilId}:${scId}`

  for (const row of data) {
    if (!pupilMap.has(row.pupilId)) {
      pupilMap.set(row.pupilId, { pupilId: row.pupilId, pupilName: row.pupilName })
    }
    if (!scMap.has(row.scId)) {
      scMap.set(row.scId, { scId: row.scId, scTitle: row.scTitle, scOrder: row.scOrder })
    }
    ratingMap.set(`${row.pupilId}:${row.scId}`, row.rating)
  }

  const pupils = Array.from(pupilMap.values()).sort((a, b) =>
    a.pupilName.localeCompare(b.pupilName)
  )
  const successCriteria = Array.from(scMap.values()).sort((a, b) => a.scOrder - b.scOrder)

  if (pupils.length === 0 || successCriteria.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          No progress data available for this class and learning objective yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-sm font-semibold text-foreground">
                Pupil
              </th>
              <th className="px-3 py-3 text-center text-sm font-semibold text-foreground">
                Avg
              </th>
              {successCriteria.map((sc) => (
                <th
                  key={sc.scId}
                  className="px-3 py-3 text-center text-sm font-semibold text-foreground"
                >
                  <div className="min-w-[80px]">
                    {sc.scTitle}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pupils.map((pupil) => {
              // Calculate row average
              const ratings = successCriteria
                .map(sc => ratingMap.get(`${pupil.pupilId}:${sc.scId}`))
                .filter((r): r is number => typeof r === 'number' && !Number.isNaN(r))
              const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null

              return (
                <tr key={pupil.pupilId} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3">
                    <Link
                      href={`/lo-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(loId)}/${encodeURIComponent(pupil.pupilId)}`}
                      className="text-sm font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {pupil.pupilName}
                    </Link>
                  </td>
                  <td className={`px-3 py-3 ${getCellBgColor(avg)}`}>
                    <div className={`text-center text-sm font-semibold ${getMetricColor(avg)}`}>
                      {formatPercent(avg)}
                    </div>
                  </td>
                  {successCriteria.map((sc) => {
                    const rating = ratingMap.get(`${pupil.pupilId}:${sc.scId}`) ?? null

                    return (
                      <td
                        key={sc.scId}
                        className={`px-3 py-3 ${getCellBgColor(rating)}`}
                      >
                        <div className={`text-center text-sm font-semibold ${getMetricColor(rating)}`}>
                          {formatPercent(rating)}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Score:</div>
          <div>Individual success criteria score per pupil</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-600"></div>
            <span>&ge;70%</span>
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
