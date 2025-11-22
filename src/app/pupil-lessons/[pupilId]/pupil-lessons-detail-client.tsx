"use client"

import { useState } from "react"
import Link from "next/link"
import { addWeeks, format, parseISO } from "date-fns"
import { ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { PupilLessonsDetail } from "@/lib/pupil-lessons-data"

function formatLessonDate(value: string): string {
  try {
    const parsed = parseISO(value)
    if (Number.isNaN(parsed.getTime())) {
      return value
    }

    return format(parsed, "dd-MM-yyyy")
  } catch {
    return value
  }
}

function parseDateValue(value: string | null) {
  if (!value) {
    return null
  }

  try {
    const parsed = parseISO(value)
    if (Number.isNaN(parsed.getTime())) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function formatDisplayDate(date: Date | null) {
  if (!date) {
    return "No scheduled date"
  }

  try {
    return format(date, "dd-MM-yyyy")
  } catch {
    return "No scheduled date"
  }
}

function getWeekWindow(weekStart: string) {
  const issuedDate = parseDateValue(weekStart)
  const dueDate = issuedDate ? addWeeks(issuedDate, 1) : null

  return {
    weekIssued: formatDisplayDate(issuedDate),
    weekDue: formatDisplayDate(dueDate),
  }
}

type PupilLessonsDetailClientProps = {
  detail: PupilLessonsDetail
  pupilId: string
}

export function PupilLessonsDetailClient({ detail, pupilId }: PupilLessonsDetailClientProps) {
  const { weeks } = detail
  const [collapsedLessons, setCollapsedLessons] = useState<Record<string, boolean>>({})

  if (weeks.length === 0) {
    return <p className="text-sm text-muted-foreground">No lessons recorded yet.</p>
  }

  const toggleLesson = (lessonId: string) => {
    setCollapsedLessons((previous) => ({
      ...previous,
      [lessonId]: !previous[lessonId],
    }))
  }

  return (
    <div className="space-y-8 sm:space-y-10">
      {weeks.map((week) => {
        const { weekIssued, weekDue } = getWeekWindow(week.weekStart)

        return (
          <section
            key={week.weekStart}
            className="space-y-6 rounded-2xl border border-border/60 bg-card/50 p-4 shadow-sm sm:p-6"
          >
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground sm:text-2xl">{week.label}</h2>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Week issued: {weekIssued}
                {weekDue ? ` · Week due: ${weekDue}` : null}
              </p>
            </div>

            <div className="space-y-6">
              {week.subjects.map((subject, index) => (
                <div key={`${subject.subject ?? "subject"}-${index}`} className="space-y-4">
                  <h3 className="text-base font-semibold text-foreground">{subject.subject ?? "Subject not set"}</h3>

                  <div className="space-y-4">
                    {subject.lessons.map((lesson) => {
                      const isLessonCollapsed = collapsedLessons[lesson.lessonId] ?? false

                      return (
                        <Card key={lesson.lessonId} className="border-border/70 shadow-sm">
                          <CardHeader className="space-y-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleLesson(lesson.lessonId)}
                                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8 sm:p-1.5"
                                    aria-expanded={!isLessonCollapsed}
                                    aria-label={isLessonCollapsed ? "Expand lesson" : "Collapse lesson"}
                                  >
                                    <ChevronDown
                                      className={cn(
                                        "h-4 w-4 transition-transform",
                                        isLessonCollapsed ? "-rotate-90" : "rotate-0",
                                      )}
                                    />
                                  </button>
                                  <CardTitle className="text-lg font-semibold text-foreground">
                                    <Link
                                      href={`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
                                      className="text-foreground underline-offset-4 hover:text-primary hover:underline"
                                    >
                                      {lesson.lessonTitle}
                                    </Link>
                                  </CardTitle>
                                  {lesson.hasHomework ? (
                                    <Badge
                                      variant="secondary"
                                      className="bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                                    >
                                      Homework set
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="text-xs text-muted-foreground sm:text-sm">
                                  {formatLessonDate(lesson.date)} • Class {lesson.groupId} • Unit {lesson.unitTitle}
                                </p>
                              </div>
                            </div>
                          </CardHeader>
                          {isLessonCollapsed ? null : (
                            <CardContent className="space-y-4 sm:space-y-3">
                              {lesson.objectives.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No learning objectives linked to this lesson yet.
                                </p>
                              ) : (
                                lesson.objectives.map((objective) => (
                                  <div
                                    key={objective.id}
                                    className="space-y-2 rounded-md border border-border/50 bg-muted/30 p-3"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-sm font-medium text-foreground">{objective.title}</p>
                                      {objective.assessmentObjectiveCode ? (
                                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                          AO {objective.assessmentObjectiveCode}
                                        </span>
                                      ) : null}
                                    </div>

                                    {objective.successCriteria.length === 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        No success criteria linked to this objective.
                                      </p>
                                    ) : (
                                      <ul className="list-disc space-y-2 pl-4 text-xs text-muted-foreground sm:space-y-1">
                                        {objective.successCriteria.map((criterion) => (
                                          <li key={criterion.id}>
                                            {criterion.description}
                                            {typeof criterion.level === "number" ? ` • Level ${criterion.level}` : null}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ))
                              )}
                            </CardContent>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
