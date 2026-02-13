'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { getLevelForYearScore } from '@/lib/levels'

type LessonMatrixData = {
  lessonId: string
  lessonTitle: string
  pupilId: string
  firstName: string
  lastName: string
  avgScore: number | null
}

type LessonMatrixProps = {
  data: LessonMatrixData[]
  summativeOnly: boolean
  groupId: string
}

type MatrixStructure = {
  pupils: { pupilId: string; firstName: string; lastName: string }[]
  lessons: {
    lessonId: string
    lessonTitle: string
    pupilMetrics: Map<string, {
      avgScore: number | null
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

function parseYearFromGroupId(groupId: string): number | null {
  // Expected format: "25-7A-IT" where 7 is the year group
  const match = groupId.match(/^\d+-(\d+)[A-Z]?-/)
  if (match && match[1]) {
    const year = parseInt(match[1], 10)
    if (year >= 7 && year <= 11) {
      return year
    }
  }
  return null
}

function calculatePupilAverage(
  pupilId: string,
  lessons: { pupilMetrics: Map<string, { avgScore: number | null }> }[]
): number | null {
  const scores: number[] = []

  for (const lesson of lessons) {
    const metrics = lesson.pupilMetrics.get(pupilId)
    if (metrics && typeof metrics.avgScore === 'number' && !Number.isNaN(metrics.avgScore)) {
      scores.push(metrics.avgScore)
    }
  }

  if (scores.length === 0) {
    return null
  }

  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

export function LessonMatrix({ data, summativeOnly, groupId }: LessonMatrixProps) {
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

  const yearGroup = parseYearFromGroupId(groupId)

  // Build matrix structure
  const matrix: MatrixStructure = {
    pupils: [],
    lessons: []
  }

  const pupilMap = new Map<string, { pupilId: string; firstName: string; lastName: string }>()
  const lessonMap = new Map<string, {
    lessonId: string
    lessonTitle: string
    pupilMetrics: Map<string, {
      avgScore: number | null
    }>
  }>()

  for (const row of data) {
    // Track pupils
    if (!pupilMap.has(row.pupilId)) {
      pupilMap.set(row.pupilId, {
        pupilId: row.pupilId,
        firstName: row.firstName,
        lastName: row.lastName
      })
    }

    // Track lessons and metrics
    if (!lessonMap.has(row.lessonId)) {
      lessonMap.set(row.lessonId, {
        lessonId: row.lessonId,
        lessonTitle: row.lessonTitle,
        pupilMetrics: new Map()
      })
    }

    const lessonEntry = lessonMap.get(row.lessonId)!
    lessonEntry.pupilMetrics.set(row.pupilId, {
      avgScore: row.avgScore
    })
  }

  matrix.pupils = Array.from(pupilMap.values()).sort((a, b) => {
    const lastNameCompare = a.lastName.localeCompare(b.lastName)
    if (lastNameCompare !== 0) return lastNameCompare
    return a.firstName.localeCompare(b.firstName)
  })
  matrix.lessons = Array.from(lessonMap.values())

  if (matrix.pupils.length === 0 || matrix.lessons.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          No lesson data available for this unit yet.
        </p>
      </div>
    )
  }

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

      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-sm font-semibold text-foreground">
                Pupil
              </th>
              {matrix.lessons.map((lesson) => (
                <th
                  key={lesson.lessonId}
                  className="px-3 py-3 text-center text-sm font-semibold text-foreground"
                >
                  <div className="min-w-[80px]">
                    {lesson.lessonTitle}
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-center text-sm font-semibold text-foreground bg-blue-50 dark:bg-blue-900/20">
                <div className="min-w-[80px]">
                  Average
                </div>
              </th>
              <th className="px-3 py-3 text-center text-sm font-semibold text-foreground bg-blue-50 dark:bg-blue-900/20">
                <div className="min-w-[80px]">
                  Level
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.pupils.map((pupil) => {
              const avgScore = calculatePupilAverage(pupil.pupilId, matrix.lessons)
              const level = getLevelForYearScore(yearGroup, avgScore)

              return (
                <tr key={pupil.pupilId} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium text-foreground">
                    {pupil.firstName} {pupil.lastName}
                  </td>
                  {matrix.lessons.map((lesson) => {
                    const metrics = lesson.pupilMetrics.get(pupil.pupilId)
                    if (!metrics) {
                      return (
                        <td
                          key={lesson.lessonId}
                          className="px-3 py-3 text-center text-xs text-muted-foreground"
                        >
                          —
                        </td>
                      )
                    }

                    return (
                      <td
                        key={lesson.lessonId}
                        className={`px-3 py-3 ${getCellBgColor(metrics.avgScore)}`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <div className={`text-sm font-semibold ${getMetricColor(metrics.avgScore)}`}>
                            {formatPercent(metrics.avgScore)}
                          </div>
                        </div>
                      </td>
                    )
                  })}
                  <td className={`px-3 py-3 bg-blue-50 dark:bg-blue-900/20 ${getCellBgColor(avgScore)}`}>
                    <div className="flex flex-col items-center gap-1">
                      <div className={`text-sm font-bold ${getMetricColor(avgScore)}`}>
                        {formatPercent(avgScore)}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 bg-blue-50 dark:bg-blue-900/20">
                    <div className="flex items-center justify-center">
                      <div className="text-sm font-bold text-foreground">
                        {level ?? '—'}
                      </div>
                    </div>
                  </td>
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
