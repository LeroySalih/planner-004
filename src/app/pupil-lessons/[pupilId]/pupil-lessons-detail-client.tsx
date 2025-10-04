"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { addWeeks, format, parseISO } from "date-fns"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { PupilLessonsDetail } from "@/lib/pupil-lessons-data"

function formatLessonDate(value: string): string {
  try {
    const parsed = parseISO(value)
    if (Number.isNaN(parsed.getTime())) {
      return value
    }

    return format(parsed, "EEE d MMM yyyy")
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
    return format(date, "do MMM yyyy")
  } catch {
    return "No scheduled date"
  }
}

function getWeekLabels(value: string | null) {
  const issuedDate = parseDateValue(value)
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
  const { homework, weeks } = detail
  const [lessonFilter, setLessonFilter] = useState("")

  const filteredWeeks = useMemo(() => {
    const query = lessonFilter.trim().toLowerCase()
    if (!query) {
      return weeks
    }

    return weeks
      .map((week) => {
        const weekMatch = week.label.toLowerCase().includes(query)

        const filteredSubjects = week.subjects
          .map((subject) => {
            const subjectLabel = subject.subject ?? "Subject not set"
            const subjectMatch = subjectLabel.toLowerCase().includes(query)

            const lessons = subject.lessons.filter((lesson) => {
              const formattedDate = formatLessonDate(lesson.date).toLowerCase()
              const isoDate = (() => {
                try {
                  return parseISO(lesson.date).toISOString().slice(0, 10)
                } catch {
                  return ""
                }
              })()

              return (
                subjectMatch ||
                weekMatch ||
                lesson.lessonTitle.toLowerCase().includes(query) ||
                (lesson.unitTitle ?? "").toLowerCase().includes(query) ||
                formattedDate.includes(query) ||
                isoDate.includes(query)
              )
            })

            return lessons.length > 0 ? { ...subject, lessons } : null
          })
          .filter((subject): subject is NonNullable<typeof subject> => Boolean(subject))

        return filteredSubjects.length > 0 ? { ...week, subjects: filteredSubjects } : null
      })
      .filter((week): week is NonNullable<typeof week> => Boolean(week))
  }, [lessonFilter, weeks])

  return (
    <Tabs defaultValue="homework" className="space-y-6">
      <TabsList className="grid w-full gap-2 sm:grid-cols-2">
        <TabsTrigger value="homework">Homework</TabsTrigger>
        <TabsTrigger value="lessons">Lessons</TabsTrigger>
      </TabsList>

      <TabsContent value="homework" className="space-y-6">
        {homework.length === 0 ? (
          <p className="text-sm text-muted-foreground">No homework has been set for this pupil yet.</p>
        ) : (
          homework.map((section) => {
            const { weekDue, weekIssued } = getWeekLabels(section.date)

            return (
              <section key={section.date ?? "no-date"} className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">Week due: {weekDue}</h2>
                  <p className="text-xs text-muted-foreground">Week issued: {weekIssued}</p>
                  <p className="text-xs text-muted-foreground">Homework activities planned for this lesson date.</p>
                </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {section.items.map((item) => (
                  <Card key={item.activityId} className="border-border/80">
                    <CardHeader className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base font-semibold text-foreground">{item.activityTitle}</CardTitle>
                        <Link
                          href={`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(item.lessonId)}`}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {item.lessonTitle}
                        </Link>
                      </div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {item.subject ?? "Subject not set"}
                      </p>
                    </CardHeader>
                  </Card>
                ))}
              </div>
              </section>
            )
          })
        )}
      </TabsContent>

      <TabsContent value="lessons" className="space-y-6">
        {weeks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No previous lessons recorded yet.</p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="lessons-filter">
                Filter by subject, date, lesson, or unit
              </label>
              <input
                id="lessons-filter"
                value={lessonFilter}
                onChange={(event) => setLessonFilter(event.target.value)}
                placeholder="Start typing to filter lessons"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            {filteredWeeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lessons match this filter.</p>
            ) : (
              filteredWeeks.map((week) => (
                <section key={week.weekStart} className="space-y-4">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{week.label}</h2>
                    <p className="text-xs text-muted-foreground">Lessons completed in this week.</p>
                  </div>

                  <div className="space-y-5">
                    {week.subjects.map((subject, index) => (
                      <div key={`${subject.subject ?? "subject"}-${index}`} className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {subject.subject ?? "Subject not set"}
                    </h3>
                    <ul className="space-y-3">
                      {subject.lessons.map((lesson) => (
                        <li key={lesson.lessonId} className="rounded-lg border border-border/70 p-4">
                          <div className="flex flex-col gap-1">
                            <Link
                              href={`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
                              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {lesson.lessonTitle}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {formatLessonDate(lesson.date)} • Class {lesson.groupId} • Unit {lesson.unitTitle}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
              ))
            )}
          </>
        )}
      </TabsContent>
    </Tabs>
  )
}
