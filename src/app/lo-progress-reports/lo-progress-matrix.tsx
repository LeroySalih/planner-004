'use client'

import { useState } from 'react'
import Link from 'next/link'

type MatrixData = {
  groupId: string
  groupSubject: string
  loId: string
  loTitle: string
  aoId: string
  aoTitle: string
  curriculumId: string | null
  curriculumTitle: string | null
  unitId: string | null
  unitTitle: string | null
  pupilCount: number
  avgRating: number | null
}

type LOProgressMatrixProps = {
  data: MatrixData[]
}

type SubjectData = {
  subject: string
  classes: string[]
  learningObjectives: {
    loId: string
    loTitle: string
    aoId: string
    aoTitle: string
    curriculumId: string | null
    curriculumTitle: string | null
    unitId: string | null
    unitTitle: string | null
    classMetrics: Map<string, {
      avgRating: number | null
      pupilCount: number
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

function sortClassIds(classIds: string[]): string[] {
  return classIds.sort((a, b) => {
    const yearA = parseInt(a.match(/^\d+/)?.[0] || '0')
    const yearB = parseInt(b.match(/^\d+/)?.[0] || '0')
    if (yearA !== yearB) return yearA - yearB
    return a.localeCompare(b)
  })
}

export function LOProgressMatrix({ data }: LOProgressMatrixProps) {
  const subjectMap = new Map<string, SubjectData>()

  for (const row of data) {
    const subject = row.groupSubject || 'Unknown'

    if (!subjectMap.has(subject)) {
      subjectMap.set(subject, {
        subject,
        classes: [],
        learningObjectives: []
      })
    }

    const subjectData = subjectMap.get(subject)!

    if (!subjectData.classes.includes(row.groupId)) {
      subjectData.classes.push(row.groupId)
    }

    let loEntry = subjectData.learningObjectives.find(lo => lo.loId === row.loId)
    if (!loEntry) {
      loEntry = {
        loId: row.loId,
        loTitle: row.loTitle,
        aoId: row.aoId,
        aoTitle: row.aoTitle,
        curriculumId: row.curriculumId,
        curriculumTitle: row.curriculumTitle,
        unitId: row.unitId,
        unitTitle: row.unitTitle,
        classMetrics: new Map()
      }
      subjectData.learningObjectives.push(loEntry)
    }

    loEntry.classMetrics.set(row.groupId, {
      avgRating: row.avgRating,
      pupilCount: row.pupilCount
    })
  }

  for (const subjectData of subjectMap.values()) {
    subjectData.classes = sortClassIds(subjectData.classes)
  }

  const subjects = Array.from(subjectMap.keys()).sort()
  const [activeTab, setActiveTab] = useState<string>(subjects[0] || '')
  const [curriculumFilter, setCurriculumFilter] = useState<string>('')
  const [aoFilter, setAoFilter] = useState<string>('')
  const [unitFilter, setUnitFilter] = useState<string>('')

  if (subjects.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          No progress data available yet.
        </p>
      </div>
    )
  }

  const activeSubjectData = subjectMap.get(activeTab)

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-border">
        {subjects.map((subject) => (
          <button
            key={subject}
            onClick={() => setActiveTab(subject)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === subject
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {subject}
          </button>
        ))}
      </div>

      {activeSubjectData && (() => {
        // Build curriculum options from current subject's LOs
        const curriculumOptions = new Map<string, string>()
        for (const lo of activeSubjectData.learningObjectives) {
          if (lo.curriculumId && lo.curriculumTitle) {
            curriculumOptions.set(lo.curriculumId, lo.curriculumTitle)
          }
        }

        // Build AO options - only AOs matching the current curriculum filter
        const aoOptions = new Map<string, string>()
        for (const lo of activeSubjectData.learningObjectives) {
          if (curriculumFilter && lo.curriculumId !== curriculumFilter) continue
          aoOptions.set(lo.aoId, lo.aoTitle)
        }
        const effectiveAoFilter = aoOptions.has(aoFilter) ? aoFilter : ''

        // Build unit options - only units matching the current curriculum + AO filter
        const unitOptions = new Map<string, string>()
        for (const lo of activeSubjectData.learningObjectives) {
          if (curriculumFilter && lo.curriculumId !== curriculumFilter) continue
          if (effectiveAoFilter && lo.aoId !== effectiveAoFilter) continue
          if (lo.unitId && lo.unitTitle) {
            unitOptions.set(lo.unitId, lo.unitTitle)
          }
        }
        const effectiveUnitFilter = unitOptions.has(unitFilter) ? unitFilter : ''

        // Filter LOs
        const filteredLOs = activeSubjectData.learningObjectives.filter((lo) => {
          if (curriculumFilter && lo.curriculumId !== curriculumFilter) return false
          if (effectiveAoFilter && lo.aoId !== effectiveAoFilter) return false
          if (effectiveUnitFilter && lo.unitId !== effectiveUnitFilter) return false
          return true
        })

        // Only show classes that have data for the filtered LOs
        const filteredClasses = activeSubjectData.classes.filter((classId) =>
          filteredLOs.some((lo) => lo.classMetrics.has(classId))
        )

        return <>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor="curriculum-filter" className="text-sm font-medium text-muted-foreground whitespace-nowrap">Curriculum</label>
            <select
              id="curriculum-filter"
              value={curriculumFilter}
              onChange={(e) => { setCurriculumFilter(e.target.value); setAoFilter(''); setUnitFilter('') }}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
            >
              <option value="">All</option>
              {Array.from(curriculumOptions.entries())
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, title]) => (
                  <option key={id} value={id}>{title}</option>
                ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="ao-filter" className="text-sm font-medium text-muted-foreground whitespace-nowrap">AO</label>
            <select
              id="ao-filter"
              key={curriculumFilter}
              value={effectiveAoFilter}
              onChange={(e) => { setAoFilter(e.target.value); setUnitFilter('') }}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
            >
              <option value="">All</option>
              {Array.from(aoOptions.entries())
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, title]) => (
                  <option key={id} value={id}>{title}</option>
                ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="unit-filter" className="text-sm font-medium text-muted-foreground whitespace-nowrap">Unit</label>
            <select
              id="unit-filter"
              key={`${curriculumFilter}-${effectiveAoFilter}`}
              value={effectiveUnitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs"
            >
              <option value="">All</option>
              {Array.from(unitOptions.entries())
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, title]) => (
                  <option key={id} value={id}>{title}</option>
                ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-sm font-semibold text-foreground">
                  Learning Objective
                </th>
                <th className="px-3 py-3 text-center text-sm font-semibold text-foreground">
                  Avg
                </th>
                {filteredClasses.map((classId) => (
                  <th
                    key={classId}
                    className="px-3 py-3 text-center text-sm font-semibold"
                  >
                    <Link
                      href={`/lo-progress-reports/${encodeURIComponent(classId)}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {classId}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLOs.map((lo) => (
                <tr key={lo.loId} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3">
                    <div className="text-xs text-muted-foreground">{lo.aoTitle}</div>
                    <div className="text-sm font-medium text-foreground">{lo.loTitle}</div>
                  </td>
                  {(() => {
                    const ratings = filteredClasses
                      .map(cId => lo.classMetrics.get(cId)?.avgRating)
                      .filter((r): r is number => typeof r === 'number' && !Number.isNaN(r))
                    const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null
                    return (
                      <td className={`px-3 py-3 ${getCellBgColor(avg)}`}>
                        <div className={`text-center text-sm font-semibold ${getMetricColor(avg)}`}>
                          {formatPercent(avg)}
                        </div>
                      </td>
                    )
                  })()}
                  {filteredClasses.map((classId) => {
                    const metrics = lo.classMetrics.get(classId)
                    if (!metrics) {
                      return (
                        <td
                          key={classId}
                          className="px-3 py-3 text-center text-xs text-muted-foreground"
                        >
                          —
                        </td>
                      )
                    }

                    return (
                      <td
                        key={classId}
                        className={`px-3 py-3 ${getCellBgColor(metrics.avgRating)}`}
                      >
                        <Link
                          href={`/lo-progress-reports/${encodeURIComponent(classId)}/${encodeURIComponent(lo.loId)}`}
                          className="block"
                        >
                          <div className="flex flex-col items-center gap-1 hover:opacity-80 transition-opacity">
                            <div className={`text-sm font-semibold ${getMetricColor(metrics.avgRating)}`}>
                              {formatPercent(metrics.avgRating)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {metrics.pupilCount}p
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
        </>
      })()}

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
