'use client'

import { useState } from 'react'
import Link from 'next/link'

type MatrixData = {
  groupId: string
  groupSubject: string
  loId: string
  loTitle: string
  aoTitle: string
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
    aoTitle: string
    classMetrics: Map<string, {
      avgRating: number | null
      pupilCount: number
    }>
  }[]
}

function formatRating(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return value.toFixed(1)
}

function getMetricColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'text-muted-foreground'
  }
  if (value < 2) {
    return 'text-red-600 dark:text-red-400'
  } else if (value < 3) {
    return 'text-amber-600 dark:text-amber-400'
  } else {
    return 'text-green-600 dark:text-green-400'
  }
}

function getCellBgColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'bg-muted/30'
  }
  if (value < 2) {
    return 'bg-red-50 dark:bg-red-900/20'
  } else if (value < 3) {
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
        aoTitle: row.aoTitle,
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

      {activeSubjectData && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-sm font-semibold text-foreground">
                  Learning Objective
                </th>
                {activeSubjectData.classes.map((classId) => (
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
              {activeSubjectData.learningObjectives.map((lo) => (
                <tr key={lo.loId} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3">
                    <div className="text-xs text-muted-foreground">{lo.aoTitle}</div>
                    <div className="text-sm font-medium text-foreground">{lo.loTitle}</div>
                  </td>
                  {activeSubjectData.classes.map((classId) => {
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
                        <div className="flex flex-col items-center gap-1">
                          <div className={`text-sm font-semibold ${getMetricColor(metrics.avgRating)}`}>
                            {formatRating(metrics.avgRating)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {metrics.pupilCount}p
                          </div>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Rating:</div>
          <div>Average success criteria rating (0-4)</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-600"></div>
            <span>≥3.0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-amber-600"></div>
            <span>2.0-2.9</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-red-600"></div>
            <span>&lt;2.0</span>
          </div>
        </div>
      </div>
    </div>
  )
}
