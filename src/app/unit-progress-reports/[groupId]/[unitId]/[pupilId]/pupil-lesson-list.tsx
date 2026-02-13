'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type Lesson = {
  lessonId: string
  lessonTitle: string
  avgScore: number | null
}

type PupilLessonListProps = {
  lessons: Lesson[]
  summativeOnly: boolean
}

function formatPercent(value: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

function getMetricColor(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'bg-muted'
  }
  const percent = value * 100
  if (percent < 40) {
    return 'bg-red-100 dark:bg-red-900/30'
  } else if (percent < 70) {
    return 'bg-amber-100 dark:bg-amber-900/30'
  } else {
    return 'bg-green-100 dark:bg-green-900/30'
  }
}

export function PupilLessonList({ lessons, summativeOnly }: PupilLessonListProps) {
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

  if (lessons.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          No lesson data available for this pupil and unit yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
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

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Lessons</h2>
        <div className="space-y-3">
          {lessons.map((lesson) => (
            <div
              key={lesson.lessonId}
              className="flex items-center justify-between rounded-lg border border-border bg-background p-4"
            >
              <div className="flex-1">
                <h3 className="font-medium text-foreground">{lesson.lessonTitle}</h3>
              </div>

              <div className="flex flex-shrink-0 gap-3">
                <div className={`rounded-md px-3 py-2 text-center ${getMetricColor(lesson.avgScore)}`}>
                  <div className="text-lg font-semibold text-foreground">
                    {formatPercent(lesson.avgScore)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Score
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-100 dark:bg-green-900/30"></div>
            <span>≥70%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-amber-100 dark:bg-amber-900/30"></div>
            <span>40-69%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-red-100 dark:bg-red-900/30"></div>
            <span>&lt;40%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
