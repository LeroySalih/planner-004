import Link from "next/link"
import { format, parseISO } from "date-fns"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PupilUnitsDetail, PupilUnitLesson } from "@/lib/pupil-units-data"

import { LessonMedia } from "./lesson-media"

function formatDate(value: string | null) {
  if (!value) return "No date set"
  try {
    return format(parseISO(value), "dd-MM-yyyy")
  } catch {
    return value
  }
}

function renderLessonObjectivesInline(lesson: PupilUnitLesson) {
  if (lesson.objectives.length === 0) {
    return <span className="text-xs text-muted-foreground">LO: None set</span>
  }

  const titles = lesson.objectives.map((objective) => objective.title).join(", ")
  return <span className="text-xs text-muted-foreground">LO: {titles}</span>
}

export function PupilUnitsView({ detail }: { detail: PupilUnitsDetail }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-6 py-6 text-white shadow-lg sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">Pupil Units</h1>
          <p className="text-sm text-slate-100 sm:text-base">
            Units and lessons assigned to {detail.pupilName} grouped by subject. Tap a lesson to view the details page.
          </p>
        </div>
      </header>

      <div className="space-y-8 sm:space-y-10">
        {detail.subjects.map((subjectEntry) => (
          <section
            key={subjectEntry.subject ?? "subject-not-set"}
            className="space-y-4 p-4 sm:p-6"
          >
            <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">
              {subjectEntry.subject || "Subject not set"}
            </h2>

            {subjectEntry.units.length === 0 ? (
              <p className="text-sm text-muted-foreground">No units assigned for this subject yet.</p>
            ) : (
              <div className="space-y-5">
                {subjectEntry.units.map((unit) => (
                  <Card key={unit.unitId} className="border border-border/70 shadow-sm">
                    <CardHeader className="space-y-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <CardTitle className="text-lg font-semibold text-foreground">{unit.unitTitle}</CardTitle>
                        <p className="text-xs text-muted-foreground sm:text-right">
                          First lesson: {formatDate(unit.firstLessonDate)}
                        </p>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="relative space-y-4 border-l border-border/60 pl-4">
                        {unit.lessons.map((lesson) => (
                          <div key={lesson.lessonId} className="relative p-2 sm:p-3">
                            <span
                              aria-hidden
                              className="absolute -left-2.5 top-5 h-3 w-3 rounded-full border-2 border-background bg-primary"
                            />
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-wrap items-center gap-3">
                                {lesson.isEnrolled ? (
                                  <Link
                                    href={`/pupil-lessons/${encodeURIComponent(detail.pupilId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
                                    className="text-base font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline sm:text-lg"
                                  >
                                    {lesson.lessonTitle}
                                  </Link>
                                ) : (
                                  <span className="text-base font-semibold text-foreground sm:text-lg">
                                    {lesson.lessonTitle}
                                  </span>
                                )}
                                <span className="text-muted-foreground">•</span>
                                {renderLessonObjectivesInline(lesson)}
                              </div>
                              <p className="text-xs text-muted-foreground sm:text-sm sm:ml-auto sm:text-right">
                                Start date: {formatDate(lesson.startDate)}
                              </p>
                            </div>

                            <div className="mt-3 space-y-3">
                              <LessonMedia
                                lessonId={lesson.lessonId}
                                lessonTitle={lesson.lessonTitle}
                                images={lesson.displayImages}
                                files={lesson.files}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  )
}
