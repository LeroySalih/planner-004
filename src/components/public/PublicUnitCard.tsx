"use client"

import type { PublicLesson } from "@/lib/server-actions/lessons"

interface PublicUnitCardProps {
  unitTitle: string
  curriculumTitle: string
  lessons: PublicLesson[]
  onSelectLesson: (lesson: PublicLesson) => void
}

export function PublicUnitCard({
  unitTitle,
  curriculumTitle,
  lessons,
  onSelectLesson,
}: PublicUnitCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <p className="font-semibold text-foreground">{unitTitle}</p>
        <p className="text-xs text-muted-foreground">{curriculumTitle}</p>
      </div>
      <ul className="space-y-1">
        {lessons.map((lesson) => (
          <li key={lesson.lessonId}>
            <button
              type="button"
              onClick={() => onSelectLesson(lesson)}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              📄 {lesson.lessonTitle}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
