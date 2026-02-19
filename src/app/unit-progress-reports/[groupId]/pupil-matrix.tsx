'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type SortField = 'firstName' | 'lastName' | 'score'
type SortDir = 'asc' | 'desc'

type PupilMatrixData = {
  unitId: string
  unitTitle: string
  unitSubject: string | null
  pupilId: string
  firstName: string
  lastName: string
  avgScore: number | null
}

type PupilMatrixProps = {
  groupId: string
  data: PupilMatrixData[]
  summativeOnly: boolean
}

type MatrixStructure = {
  pupils: {
    pupilId: string
    firstName: string
    lastName: string
    unitMetrics: Map<string, {
      avgScore: number | null
    }>
  }[]
  units: {
    unitId: string
    unitTitle: string
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

export function PupilMatrix({ groupId, data, summativeOnly }: PupilMatrixProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleToggle = (checked: boolean) => {
    const params = new URLSearchParams(searchParams)
    if (checked) {
      params.set('summative', 'true')
    } else {
      params.delete('summative')
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  // Build matrix structure
  const matrix: MatrixStructure = {
    pupils: [],
    units: []
  }

  const pupilMap = new Map<string, {
    pupilId: string
    firstName: string
    lastName: string
    unitMetrics: Map<string, {
      avgScore: number | null
    }>
  }>()
  const unitMap = new Map<string, { unitId: string; unitTitle: string }>()

  for (const row of data) {
    // Track pupils and their unit metrics
    if (!pupilMap.has(row.pupilId)) {
      pupilMap.set(row.pupilId, {
        pupilId: row.pupilId,
        firstName: row.firstName,
        lastName: row.lastName,
        unitMetrics: new Map()
      })
    }

    const pupilEntry = pupilMap.get(row.pupilId)!
    pupilEntry.unitMetrics.set(row.unitId, {
      avgScore: row.avgScore
    })

    // Track units
    if (!unitMap.has(row.unitId)) {
      unitMap.set(row.unitId, {
        unitId: row.unitId,
        unitTitle: row.unitTitle
      })
    }
  }

  matrix.pupils = Array.from(pupilMap.values())
  matrix.units = Array.from(unitMap.values())

  const [sortField, setSortField] = useState<SortField>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function getPupilAvg(pupil: typeof matrix.pupils[number]): number | null {
    const scores = matrix.units
      .map(u => pupil.unitMetrics.get(u.unitId)?.avgScore)
      .filter((s): s is number => typeof s === 'number' && !Number.isNaN(s))
    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  }

  const sortedPupils = [...matrix.pupils].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'firstName') {
      const cmp = a.firstName.localeCompare(b.firstName)
      return cmp !== 0 ? cmp * dir : a.lastName.localeCompare(b.lastName) * dir
    }
    if (sortField === 'lastName') {
      const cmp = a.lastName.localeCompare(b.lastName)
      return cmp !== 0 ? cmp * dir : a.firstName.localeCompare(b.firstName) * dir
    }
    // score
    const aAvg = getPupilAvg(a)
    const bAvg = getPupilAvg(b)
    if (aAvg === null && bAvg === null) return 0
    if (aAvg === null) return 1
    if (bAvg === null) return -1
    return (aAvg - bAvg) * dir
  })

  if (matrix.pupils.length === 0 || matrix.units.length === 0) {
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
      {/* Controls */}
      <div className="flex items-center gap-6 flex-wrap rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Switch
            id="summative-toggle"
            checked={summativeOnly}
            onCheckedChange={handleToggle}
          />
          <Label htmlFor="summative-toggle" className="cursor-pointer">
            Show assessment scores only (summative activities)
          </Label>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-2">
            <label htmlFor="sort-field" className="text-sm font-medium text-muted-foreground whitespace-nowrap">Sort by</label>
            <select
              id="sort-field"
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
            >
              <option value="firstName">First name</option>
              <option value="lastName">Last name</option>
              <option value="score">Score</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="sort-dir" className="text-sm font-medium text-muted-foreground whitespace-nowrap">Order</label>
            <select
              id="sort-dir"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as SortDir)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>
      </div>

      {/* Matrix */}
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
              {matrix.units.map((unit) => (
                <th
                  key={unit.unitId}
                  className="px-3 py-3 text-center text-sm font-semibold text-foreground"
                >
                  <div className="min-w-[80px]">
                    {unit.unitTitle}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedPupils.map((pupil) => {
              const avg = getPupilAvg(pupil)
              return (
              <tr key={pupil.pupilId} className="border-b border-border last:border-b-0">
                <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium text-foreground">
                  {pupil.firstName} {pupil.lastName}
                </td>
                <td className={`px-3 py-3 ${getCellBgColor(avg)}`}>
                  <div className={`text-center text-sm font-semibold ${getMetricColor(avg)}`}>
                    {formatPercent(avg)}
                  </div>
                </td>
                {matrix.units.map((unit) => {
                  const metrics = pupil.unitMetrics.get(unit.unitId)
                  if (!metrics) {
                    return (
                      <td
                        key={unit.unitId}
                        className="px-3 py-3 text-center text-xs text-muted-foreground"
                      >
                        —
                      </td>
                    )
                  }

                  return (
                    <td
                      key={unit.unitId}
                      className={`px-3 py-3 ${getCellBgColor(metrics.avgScore)}`}
                    >
                      <Link
                        href={`/unit-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(unit.unitId)}/${encodeURIComponent(pupil.pupilId)}`}
                        className="block"
                      >
                        <div className="flex flex-col items-center gap-1 hover:opacity-80 transition-opacity">
                          <div className={`text-sm font-semibold ${getMetricColor(metrics.avgScore)}`}>
                            {formatPercent(metrics.avgScore)}
                          </div>
                        </div>
                      </Link>
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
