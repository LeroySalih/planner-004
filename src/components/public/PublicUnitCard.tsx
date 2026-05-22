"use client"

import { useState } from "react"
import type { PublicLesson } from "@/lib/server-actions/lessons"

interface PublicUnitCardProps {
  unitTitle: string
  curriculumTitle: string
  unitDescription: string | null
  lessons: PublicLesson[]
  onSelectLesson: (lesson: PublicLesson) => void
}

const INITIAL_LESSON_COUNT = 4

// Deterministic gradient + accent colour from unit title initial
function unitGradient(title: string): string {
  const gradients = [
    "from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-950/20",
    "from-amber-100 to-amber-50 dark:from-amber-900/30 dark:to-amber-950/20",
    "from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-950/20",
    "from-violet-100 to-violet-50 dark:from-violet-900/30 dark:to-violet-950/20",
    "from-rose-100 to-rose-50 dark:from-rose-900/30 dark:to-rose-950/20",
    "from-cyan-100 to-cyan-50 dark:from-cyan-900/30 dark:to-cyan-950/20",
  ]
  return gradients[title.charCodeAt(0) % gradients.length]
}

function unitTextColor(title: string): string {
  const colors = [
    "text-blue-300 dark:text-blue-600",
    "text-amber-300 dark:text-amber-600",
    "text-emerald-300 dark:text-emerald-600",
    "text-violet-300 dark:text-violet-600",
    "text-rose-300 dark:text-rose-600",
    "text-cyan-300 dark:text-cyan-600",
  ]
  return colors[title.charCodeAt(0) % colors.length]
}

export function PublicUnitCard({
  unitTitle,
  curriculumTitle,
  unitDescription,
  lessons,
  onSelectLesson,
}: PublicUnitCardProps) {
  const [showAll, setShowAll] = useState(false)
  const visibleLessons = showAll ? lessons : lessons.slice(0, INITIAL_LESSON_COUNT)
  const hiddenCount = lessons.length - INITIAL_LESSON_COUNT

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Image area — 200px */}
      <div
        className={`flex h-[200px] flex-shrink-0 items-center justify-center bg-gradient-to-br ${unitGradient(unitTitle)}`}
      >
        <span className={`select-none text-8xl font-black ${unitTextColor(unitTitle)}`}>
          {unitTitle.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col p-4">
        <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {curriculumTitle}
        </p>
        <h3 className="mb-2 font-semibold leading-snug text-foreground">{unitTitle}</h3>

        {unitDescription ? (
          <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{unitDescription}</p>
        ) : (
          <div className="mb-3" />
        )}

        <ul className="flex-1 space-y-0.5">
          {visibleLessons.map((lesson) => (
            <li key={lesson.lessonId}>
              <button
                type="button"
                onClick={() => onSelectLesson(lesson)}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span className="mr-1.5 opacity-60">📄</span>
                {lesson.lessonTitle}
              </button>
            </li>
          ))}
        </ul>

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 text-left text-xs font-medium text-primary hover:underline"
          >
            {showAll ? "Show less" : `See ${hiddenCount} more…`}
          </button>
        )}
      </div>
    </div>
  )
}
