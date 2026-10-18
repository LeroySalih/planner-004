'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ReportGrid } from '@/components/reports/report-grid'
import { getLevelForYearScore, yearGroupFromGroupId, type YearGroupLevels } from '@/lib/levels'
import { formatPercent, getCellBgColor, getMetricColor, SummativeToggle } from '../report-ui'

type SortField = 'firstName' | 'lastName' | 'score'
type SortDir = 'asc' | 'desc'

type Unit = { unitId: string; unitTitle: string }
type Cell = { unitId: string; pupilId: string; firstName: string; lastName: string; marks: number; maxMarks: number }
type Marks = { marks: number; maxMarks: number }

type GroupMatrixProps = {
  groupId: string
  units: Unit[]
  cells: Cell[]
  summativeOnly: boolean
  levelRanges: YearGroupLevels[]
}

// Progress baseline: total marks over total available, never a mean of percentages.
function percent({ marks, maxMarks }: Marks): number | null {
  return maxMarks > 0 ? (marks / maxMarks) * 100 : null
}

function add(total: Marks, next: Marks): Marks {
  return { marks: total.marks + next.marks, maxMarks: total.maxMarks + next.maxMarks }
}

export function GroupMatrix({ groupId, units, cells, summativeOnly, levelRanges }: GroupMatrixProps) {
  const [sortField, setSortField] = useState<SortField>('lastName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const yearGroup = yearGroupFromGroupId(groupId)
  const levelFor = (score: number | null) => getLevelForYearScore(levelRanges, yearGroup, score)

  const pupilMap = new Map<string, { pupilId: string; firstName: string; lastName: string; units: Map<string, Marks>; total: Marks }>()
  const unitTotals = new Map<string, Marks>()
  let classTotal: Marks = { marks: 0, maxMarks: 0 }
  for (const cell of cells) {
    const pupil = pupilMap.get(cell.pupilId) ?? {
      pupilId: cell.pupilId,
      firstName: cell.firstName,
      lastName: cell.lastName,
      units: new Map(),
      total: { marks: 0, maxMarks: 0 },
    }
    pupil.units.set(cell.unitId, cell)
    pupil.total = add(pupil.total, cell)
    pupilMap.set(cell.pupilId, pupil)
    unitTotals.set(cell.unitId, add(unitTotals.get(cell.unitId) ?? { marks: 0, maxMarks: 0 }, cell))
    classTotal = add(classTotal, cell)
  }

  const pupils = Array.from(pupilMap.values()).sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'score') {
      const aScore = percent(a.total)
      const bScore = percent(b.total)
      if (aScore === null && bScore === null) return 0
      if (aScore === null) return 1
      if (bScore === null) return -1
      return (aScore - bScore) * dir
    }
    const [first, second] = sortField === 'firstName' ? ['firstName', 'lastName'] as const : ['lastName', 'firstName'] as const
    return (a[first].localeCompare(b[first]) || a[second].localeCompare(b[second])) * dir
  })

  if (pupils.length === 0 || units.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">No progress data available for this class yet.</p>
      </div>
    )
  }

  const classAverage = percent(classTotal)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card p-4">
        <SummativeToggle summativeOnly={summativeOnly} />
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="sort-field" className="whitespace-nowrap text-sm font-medium text-muted-foreground">Sort by</label>
            <select
              id="sort-field"
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
            >
              <option value="firstName">First name</option>
              <option value="lastName">Last name</option>
              <option value="score">Average</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="sort-dir" className="whitespace-nowrap text-sm font-medium text-muted-foreground">Order</label>
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

      <ReportGrid>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted text-sm font-semibold text-foreground">
              <th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left">Pupil</th>
              <th className="px-3 py-3 text-center">Average</th>
              <th className="px-3 py-3 text-center">Level</th>
              {units.map((unit) => (
                <th key={unit.unitId} className="px-3 py-3 text-center">
                  <Link
                    href={`/unit-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(unit.unitId)}`}
                    className="block min-w-[80px] hover:underline"
                  >
                    {unit.unitTitle}
                  </Link>
                </th>
              ))}
            </tr>
            {/* In the header so it stays pinned while the pupils scroll. */}
            <tr className="border-b border-border bg-muted text-sm font-semibold">
              <th className="sticky left-0 z-10 bg-muted px-4 py-2 text-left text-muted-foreground">Class average</th>
              <th className={`px-3 py-2 text-center ${getMetricColor(classAverage)}`}>{formatPercent(classAverage)}</th>
              <th className="px-3 py-2 text-center">{levelFor(classAverage) ?? '—'}</th>
              {units.map((unit) => {
                const score = percent(unitTotals.get(unit.unitId) ?? { marks: 0, maxMarks: 0 })
                return (
                  <th key={unit.unitId} className={`px-3 py-2 text-center ${getMetricColor(score)}`}>
                    {formatPercent(score)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pupils.map((pupil) => {
              const average = percent(pupil.total)
              return (
                <tr key={pupil.pupilId} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium text-foreground">
                    {pupil.firstName} {pupil.lastName}
                  </td>
                  <td className={`px-3 py-3 text-center text-sm font-semibold ${getCellBgColor(average)} ${getMetricColor(average)}`}>
                    {formatPercent(average)}
                  </td>
                  <td className="px-3 py-3 text-center text-sm font-semibold text-foreground">
                    {levelFor(average) ?? '—'}
                  </td>
                  {units.map((unit) => {
                    const marks = pupil.units.get(unit.unitId)
                    if (!marks) {
                      return (
                        <td key={unit.unitId} className="px-3 py-3 text-center text-xs text-muted-foreground">—</td>
                      )
                    }
                    const score = percent(marks)
                    return (
                      <td key={unit.unitId} className={`px-3 py-3 ${getCellBgColor(score)}`}>
                        <Link
                          href={`/unit-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(unit.unitId)}/${encodeURIComponent(pupil.pupilId)}`}
                          className={`block text-center text-sm font-semibold transition-opacity hover:opacity-80 ${getMetricColor(score)}`}
                        >
                          {formatPercent(score)}
                        </Link>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </ReportGrid>

      <div className="flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
        <span>
          Averages are total marks over total available across the units. The level uses the year group&apos;s
          boundaries from <Link href="/admin/levels" className="underline">Levels</Link>.
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-green-600" /><span>≥70%</span></div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-amber-600" /><span>40-69%</span></div>
          <div className="flex items-center gap-1"><div className="h-3 w-3 rounded bg-red-600" /><span>&lt;40%</span></div>
        </div>
      </div>
    </div>
  )
}
