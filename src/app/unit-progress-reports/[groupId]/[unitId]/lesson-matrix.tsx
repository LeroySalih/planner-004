'use client'

type LessonMatrixData = {
  lessonId: string
  lessonTitle: string
  pupilId: string
  pupilName: string
  avgScore: number | null
}

type LessonMatrixProps = {
  data: LessonMatrixData[]
}

type MatrixStructure = {
  pupils: { pupilId: string; pupilName: string }[]
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

export function LessonMatrix({ data }: LessonMatrixProps) {
  // Build matrix structure
  const matrix: MatrixStructure = {
    pupils: [],
    lessons: []
  }

  const pupilMap = new Map<string, { pupilId: string; pupilName: string }>()
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
        pupilName: row.pupilName
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

  matrix.pupils = Array.from(pupilMap.values()).sort((a, b) =>
    a.pupilName.localeCompare(b.pupilName)
  )
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
      {/* Matrix */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-sm font-semibold text-foreground">
                Lesson
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
            {matrix.lessons.map((lesson) => (
              <tr key={lesson.lessonId} className="border-b border-border last:border-b-0">
                <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium text-foreground">
                  {lesson.lessonTitle}
                </td>
                {matrix.pupils.map((pupil) => {
                  const metrics = lesson.pupilMetrics.get(pupil.pupilId)
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
              </tr>
            ))}
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
