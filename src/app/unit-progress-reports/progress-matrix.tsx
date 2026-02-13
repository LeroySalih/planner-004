'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type MatrixData = {
  groupId: string
  groupSubject: string
  unitId: string
  unitTitle: string
  unitSubject: string | null
  pupilCount: number
  avgScore: number | null
}

type ProgressMatrixProps = {
  data: MatrixData[]
  summativeOnly: boolean
}

type SubjectData = {
  subject: string
  classes: string[]
  units: {
    unitId: string
    unitTitle: string
    classMetrics: Map<string, {
      avgScore: number | null
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

export function ProgressMatrix({ data, summativeOnly }: ProgressMatrixProps) {
  const router = useRouter()
  const pathname = usePathname()

  const handleToggle = (checked: boolean) => {
    const params = new URLSearchParams()
    if (checked) {
      params.set('summative', 'true')
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  // Group data by subject
  const subjectMap = new Map<string, SubjectData>()

  for (const row of data) {
    const subject = row.groupSubject || 'Unknown'

    if (!subjectMap.has(subject)) {
      subjectMap.set(subject, {
        subject,
        classes: [],
        units: []
      })
    }

    const subjectData = subjectMap.get(subject)!

    // Add class if not already present
    if (!subjectData.classes.includes(row.groupId)) {
      subjectData.classes.push(row.groupId)
    }

    // Find or create unit entry
    let unitEntry = subjectData.units.find(u => u.unitId === row.unitId)
    if (!unitEntry) {
      unitEntry = {
        unitId: row.unitId,
        unitTitle: row.unitTitle,
        classMetrics: new Map()
      }
      subjectData.units.push(unitEntry)
    }

    // Add metrics for this class
    unitEntry.classMetrics.set(row.groupId, {
      avgScore: row.avgScore,
      pupilCount: row.pupilCount
    })
  }

  // Sort classes within each subject
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
      {/* Toggle */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <Switch
          id="summative-toggle"
          checked={summativeOnly}
          onCheckedChange={handleToggle}
        />
        <Label htmlFor="summative-toggle" className="cursor-pointer">
          Show assessment scores only (summative activities)
        </Label>
      </div>

      {/* Tabs */}
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

      {/* Matrix */}
      {activeSubjectData && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-sm font-semibold text-foreground">
                  Unit
                </th>
                {activeSubjectData.classes.map((classId) => (
                  <th
                    key={classId}
                    className="px-3 py-3 text-center text-sm font-semibold"
                  >
                    <Link
                      href={`/unit-progress-reports/${encodeURIComponent(classId)}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {classId}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeSubjectData.units.map((unit) => (
                <tr key={unit.unitId} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium text-foreground">
                    {unit.unitTitle}
                  </td>
                  {activeSubjectData.classes.map((classId) => {
                    const metrics = unit.classMetrics.get(classId)
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
                        className={`px-3 py-3 ${getCellBgColor(metrics.avgScore)}`}
                      >
                        <Link
                          href={`/unit-progress-reports/${encodeURIComponent(classId)}/${encodeURIComponent(unit.unitId)}`}
                          className="block"
                        >
                          <div className="flex flex-col items-center gap-1 hover:opacity-80 transition-opacity">
                            <div className={`text-sm font-semibold ${getMetricColor(metrics.avgScore)}`}>
                              {formatPercent(metrics.avgScore)}
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
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Top:</div>
          <div>Score</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="font-semibold">Bottom:</div>
          <div>Pupil count</div>
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
