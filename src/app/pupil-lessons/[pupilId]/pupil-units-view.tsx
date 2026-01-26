"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { format, parseISO, differenceInMonths, addWeeks } from "date-fns"
import { Roboto_Condensed } from "next/font/google"
import { ChevronDown } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PupilUnitsDetail, PupilUnitLesson } from "@/lib/pupil-units-data"
import { StartRevisionButton } from "@/components/revisions/start-revision-button"
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

function getRevisionBadgeColor(dateString: string | null) {
  if (!dateString) return "bg-green-50 text-green-700 ring-green-600/20"
  
  try {
    const date = parseISO(dateString)
    const monthsDiff = differenceInMonths(new Date(), date)
    
    if (monthsDiff >= 2) {
      return "bg-red-50 text-red-700 ring-red-600/20"
    }
    if (monthsDiff >= 1) {
      return "bg-amber-50 text-amber-700 ring-amber-600/20"
    }
    return "bg-green-50 text-green-700 ring-green-600/20"
  } catch {
    return "bg-green-50 text-green-700 ring-green-600/20"
  }
}

const robotoCondensed = Roboto_Condensed({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
})

export function PupilUnitsView({ detail }: { detail: PupilUnitsDetail }) {
  const [selectedSubject, setSelectedSubject] = useState("All Subjects")

  const subjects = useMemo(() => {
    const subjectList = detail.subjects
      .map((s) => s.subject ?? "Subject not set")
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .sort()
    return ["All Subjects", ...subjectList]
  }, [detail])

  const filteredSubjects = useMemo(() => {
    if (selectedSubject === "All Subjects") {
      return detail.subjects
    }
    return detail.subjects.filter((s) => (s.subject ?? "Subject not set") === selectedSubject)
  }, [detail, selectedSubject])

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

      <div className="flex flex-col gap-8 sm:gap-10">
        <div className="relative flex w-fit items-center">
          <select
            id="subject-select"
            value={selectedSubject}
            onChange={(event) => setSelectedSubject(event.target.value)}
            className="cursor-pointer appearance-none bg-transparent pr-8 text-2xl font-semibold text-foreground focus:outline-none sm:text-3xl"
          >
            {subjects.map((subject) => (
              <option key={subject} value={subject}>
                {subject}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" />
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-[250px_1fr]">
          <aside className="hidden h-fit space-y-6 md:block">
            {filteredSubjects.map((subjectEntry) => (
              <div key={subjectEntry.subject ?? "sidebar-subject-not-set"} className="space-y-3">
                {filteredSubjects.length > 1 ? (
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {subjectEntry.subject || "Subject not set"}
                  </h3>
                ) : null}
                <ul className="space-y-2">
                  {subjectEntry.units.map((unit) => (
                    <li key={unit.unitId}>
                      <Link
                        href={`#unit-${unit.unitId}`}
                        className="block truncate text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
                        title={unit.unitTitle}
                      >
                        {unit.unitTitle}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </aside>

          <div className="h-[calc(100vh-16rem)] space-y-10 overflow-y-auto pr-4 pb-10">
            {filteredSubjects.map((subjectEntry) => (
              <section
                key={subjectEntry.subject ?? "subject-not-set"}
                className="space-y-8"
              >
                {subjectEntry.units.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No units assigned for this subject yet.</p>
                ) : (
                  <div className="space-y-8">
                    {subjectEntry.units.map((unit) => (
                      <div id={`unit-${unit.unitId}`} key={unit.unitId} className="scroll-mt-6">
                        <Card className="border border-border/70 shadow-sm">
                          <CardHeader className="space-y-1">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <CardTitle
                                className={`${robotoCondensed.className} text-3xl font-bold uppercase text-foreground sm:text-4xl`}
                              >
                                {unit.unitTitle}
                              </CardTitle>
                              <p className="text-xs text-muted-foreground sm:text-right">
                                First lesson: {formatDate(unit.firstLessonDate)}
                              </p>
                              {unit.unitScore !== null && unit.unitScore !== undefined && unit.unitMaxScore !== null && unit.unitMaxScore !== undefined && unit.unitMaxScore > 0 && (
                                <div className="sm:text-right">
                                  <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
                                    Unit Score: {Math.round(unit.unitScore * 10) / 10}/{unit.unitMaxScore} ({Math.round((unit.unitScore / unit.unitMaxScore) * 100)}%)
                                  </span>
                                </div>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="relative ml-4 space-y-4 border-l-2 border-slate-300 dark:border-slate-600">
                              {unit.lessons.map((lesson, index) => (
                                <div key={lesson.lessonId} className="relative py-2 pl-8 pr-2 sm:pr-3">
                                  <span
                                    aria-hidden
                                    className="absolute -left-3 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary text-xs font-bold text-primary-foreground shadow-sm"
                                  >
                                    {unit.lessons.length - index}
                                  </span>
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="flex flex-col gap-1">
                                      {lesson.isEnrolled ? (
                                        <Link
                                          href={`/pupil-lessons/${encodeURIComponent(detail.pupilId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
                                          className="text-xl font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline sm:text-2xl"
                                        >
                                          {lesson.lessonTitle}
                                        </Link>
                                      ) : (
                                        <span className="text-xl font-semibold text-foreground sm:text-2xl">
                                          {lesson.lessonTitle}
                                        </span>
                                      )}
                                      {renderLessonObjectivesInline(lesson)}
                                    </div>
                                    <div className="text-xs text-muted-foreground sm:text-sm sm:ml-auto sm:text-right flex flex-col items-end gap-1">
                                      <span>
                                        Due date:{" "}
                                        {lesson.startDate
                                          ? format(addWeeks(parseISO(lesson.startDate), 1), "dd-MM-yyyy")
                                          : "No due date"}
                                      </span>
                                      
                                      {/* Lesson Score */}
                                      {lesson.lessonScore !== null && lesson.lessonMaxScore !== null && lesson.lessonMaxScore > 0 && (
                                           <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                              Lesson Score: {Math.round(lesson.lessonScore * 10) / 10}/{lesson.lessonMaxScore} ({Math.round((lesson.lessonScore / lesson.lessonMaxScore) * 100)}%)
                                           </span>
                                      )}

                                      {/* Revision Score & Launch */}
                                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                        {lesson.revisionScore !== null && lesson.revisionMaxScore !== null && lesson.revisionMaxScore > 0 && (
                                          <>
                                            {lesson.revisionDate && (
                                                <span className="text-[10px] text-muted-foreground">
                                                    Rev: {formatDate(lesson.revisionDate)}
                                                </span>
                                            )}
                                            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${getRevisionBadgeColor(lesson.revisionDate)}`}>
                                                Revision: {Math.round(lesson.revisionScore * 10) / 10}/{lesson.revisionMaxScore} ({Math.round((lesson.revisionScore / lesson.revisionMaxScore) * 100)}%)
                                            </span>
                                          </>
                                        )}
                                        <StartRevisionButton lessonId={lesson.lessonId} compact />
                                      </div>
                                    </div>
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
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
