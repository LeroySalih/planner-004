'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ReportGrid } from '@/components/reports/report-grid'
import { getLevelForYearScore, yearGroupFromGroupId, type YearGroupLevels } from '@/lib/levels'
import { formatPercent, getCellBgColor, getMetricColor, SummativeToggle } from '../report-ui'

type SortField = 'firstName' | 'lastName' | 'score'
type SortDir = 'asc' | 'desc'

type Unit = { unitId: string; unitTitle: string }
type Assessment = { assessmentId: string; title: string }
type Pupil = { pupilId: string; firstName: string; lastName: string }
type Marks = { marks: number; maxMarks: number }
type Cell = Pupil & Marks & { unitId: string }
type AssessmentResult = Pupil & Marks & { assessmentId: string }

type GroupMatrixProps = {
  groupId: string
  units: Unit[]
  cells: Cell[]
  assessments: Assessment[]
  assessmentResults: AssessmentResult[]
  summativeOnly: boolean
  levelRanges: YearGroupLevels[]
}

// Progress baseline: total marks over total available, never a mean of percentages.
function percent({ marks, maxMarks }: Marks): number | null {
  return maxMarks > 0 ? (marks / maxMarks) * 100 : null
}

function add(total: Marks | undefined, next: Marks): Marks {
  return { marks: (total?.marks ?? 0) + next.marks, maxMarks: (total?.maxMarks ?? 0) + next.maxMarks }
}

/** The first column of each group gets a heavier left edge. */
const GROUP_EDGE = 'border-l-2 border-l-border'

function ScoreAndLevel({ score, level }: { score: number | null; level: string | null }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className={`text-sm font-semibold ${getMetricColor(score)}`}>{formatPercent(score)}</span>
      {score === null ? null : <span className="text-xs font-semibold text-foreground">{level ?? '—'}</span>}
    </div>
  )
}

export function GroupMatrix({ groupId, units, cells, assessments, assessmentResults, summativeOnly, levelRanges }: GroupMatrixProps) {
  const [sortField, setSortField] = useState<SortField>('lastName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const yearGroup = yearGroupFromGroupId(groupId)
  const levelFor = (score: number | null) => getLevelForYearScore(levelRanges, yearGroup, score)

  type PupilRow = Pupil & { units: Map<string, Marks>; assessments: Map<string, Marks>; total: Marks }
  const pupilMap = new Map<string, PupilRow>()
  const pupilRow = ({ pupilId, firstName, lastName }: Pupil) => {
    let row = pupilMap.get(pupilId)
    if (!row) {
      row = { pupilId, firstName, lastName, units: new Map(), assessments: new Map(), total: { marks: 0, maxMarks: 0 } }
      pupilMap.set(pupilId, row)
    }
    return row
  }

  // Dino: the average is over the units only; assessments are reported apart.
  const unitTotals = new Map<string, Marks>()
  let classTotal: Marks = { marks: 0, maxMarks: 0 }
  for (const cell of cells) {
    const pupil = pupilRow(cell)
    pupil.units.set(cell.unitId, cell)
    pupil.total = add(pupil.total, cell)
    unitTotals.set(cell.unitId, add(unitTotals.get(cell.unitId), cell))
    classTotal = add(classTotal, cell)
  }

  // Class average on a paper: over the pupils with a result for it.
  const assessmentTotals = new Map<string, Marks>()
  for (const result of assessmentResults) {
    pupilRow(result).assessments.set(result.assessmentId, result)
    assessmentTotals.set(result.assessmentId, add(assessmentTotals.get(result.assessmentId), result))
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

  if (pupils.length === 0 || (units.length === 0 && assessments.length === 0)) {
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
            <tr className="border-b border-border bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th rowSpan={2} className="sticky left-0 z-10 bg-muted px-4 py-3 text-left align-bottom text-sm normal-case tracking-normal text-foreground">
                Pupil
              </th>
              <th colSpan={2 + units.length} className={`px-3 py-2 text-center ${GROUP_EDGE}`}>Dino</th>
              {assessments.length > 0 ? (
                <th colSpan={assessments.length} className={`px-3 py-2 text-center ${GROUP_EDGE}`}>Assessments</th>
              ) : null}
            </tr>
            <tr className="border-b border-border bg-muted text-sm font-semibold text-foreground">
              <th className={`px-3 py-3 text-center ${GROUP_EDGE}`}>Average</th>
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
              {assessments.map((assessment, index) => (
                <th key={assessment.assessmentId} className={`px-3 py-3 text-center ${index === 0 ? GROUP_EDGE : ''}`}>
                  <Link
                    href={`/assessments/${encodeURIComponent(assessment.assessmentId)}`}
                    className="block min-w-[80px] hover:underline"
                  >
                    {assessment.title}
                  </Link>
                </th>
              ))}
            </tr>
            {/* In the header so it stays pinned while the pupils scroll. */}
            <tr className="border-b border-border bg-muted text-sm font-semibold">
              <th className="sticky left-0 z-10 bg-muted px-4 py-2 text-left text-muted-foreground">Class average</th>
              <th className={`px-3 py-2 text-center ${GROUP_EDGE} ${getMetricColor(classAverage)}`}>{formatPercent(classAverage)}</th>
              <th className="px-3 py-2 text-center">{levelFor(classAverage) ?? '—'}</th>
              {units.map((unit) => {
                const score = percent(unitTotals.get(unit.unitId) ?? { marks: 0, maxMarks: 0 })
                return (
                  <th key={unit.unitId} className={`px-3 py-2 text-center ${getMetricColor(score)}`}>
                    {formatPercent(score)}
                  </th>
                )
              })}
              {assessments.map((assessment, index) => {
                const totals = assessmentTotals.get(assessment.assessmentId)
                const score = totals ? percent(totals) : null
                return (
                  <th key={assessment.assessmentId} className={`px-3 py-2 ${index === 0 ? GROUP_EDGE : ''}`}>
                    <ScoreAndLevel score={score} level={levelFor(score)} />
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
                  <td className={`px-3 py-3 text-center text-sm font-semibold ${GROUP_EDGE} ${getCellBgColor(average)} ${getMetricColor(average)}`}>
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
                  {assessments.map((assessment, index) => {
                    const result = pupil.assessments.get(assessment.assessmentId)
                    const score = result ? percent(result) : null
                    return (
                      <td
                        key={assessment.assessmentId}
                        className={`px-3 py-2 ${index === 0 ? GROUP_EDGE : ''} ${result ? getCellBgColor(score) : ''}`}
                      >
                        {result ? (
                          <Link
                            href={`/assessments/${encodeURIComponent(assessment.assessmentId)}/pupils/${encodeURIComponent(pupil.pupilId)}`}
                            className="block transition-opacity hover:opacity-80"
                          >
                            <ScoreAndLevel score={score} level={levelFor(score)} />
                          </Link>
                        ) : (
                          <div className="text-center text-xs text-muted-foreground">—</div>
                        )}
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
          Dino averages are total marks over total available across the units. An assessment&apos;s score is the
          marks awarded over the paper&apos;s total; a pupil with no marks on a paper shows —. Levels use the year group&apos;s
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
