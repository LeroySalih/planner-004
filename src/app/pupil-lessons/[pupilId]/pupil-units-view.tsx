"use client"

import { useState, useMemo, type ReactNode } from "react"
import Link from "next/link"
import { format, parseISO, differenceInMonths, isBefore } from "date-fns"
import { cn } from "@/lib/utils"
import { lessonDueDate } from "@/lib/lesson-due-date"
import { lessonArticleFontClass } from "@/components/lesson-article/fonts"
import { ChevronIcon, LockIcon } from "@/components/lesson-article/icons"
import type { PupilUnitEntry, PupilUnitsDetail, PupilUnitLesson } from "@/lib/pupil-units-data"
import { LessonMedia } from "./lesson-media"
import { PupilPicker } from "@/components/pupil-picker"
import type { PupilPickerData } from "@/lib/pupil-picker"

function formatDate(value: string | null, pattern = "d MMM yyyy") {
  if (!value) return null
  try {
    return format(parseISO(value), pattern)
  } catch {
    return value
  }
}

/** Revision older than a month is amber, two months red. */
function revisionTone(dateString: string | null): "ok" | "amber" | "red" {
  if (!dateString) return "ok"
  try {
    const months = differenceInMonths(new Date(), parseISO(dateString))
    return months >= 2 ? "red" : months >= 1 ? "amber" : "ok"
  } catch {
    return "ok"
  }
}

function isLessonOverdueAndUnderperforming(lesson: PupilUnitLesson) {
  const due = lessonDueDate(lesson.startDate)
  if (!due || !isBefore(parseISO(due), new Date())) return false
  const maxScore = lesson.lessonMaxScore ?? 0
  if (maxScore <= 0) return false
  return (lesson.lessonScore ?? 0) / maxScore < 0.8
}

const selectClass =
  "min-h-11 w-full cursor-pointer appearance-none rounded-lg border border-la-input bg-la-card py-2 pl-3 pr-9 text-[15px] font-semibold text-la-ink focus-visible:outline-2 focus-visible:outline-la-green"

export function PupilUnitsView({
  detail,
  picker = null,
  initialUnitId = null,
}: {
  detail: PupilUnitsDetail
  /** Admin-only "view as pupil" controls; null for everyone else. */
  picker?: PupilPickerData | null
  /** A unit to open with (?unit=), e.g. from a lesson's course list. */
  initialUnitId?: string | null
}) {
  const subjectList = detail.subjects
    .map((s) => s.subject ?? "Subject not set")
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort()

  const [selectedSubject, setSelectedSubject] = useState(() => {
    const withUnit = detail.subjects.find((s) => s.units.some((u) => u.unitId === initialUnitId))
    return withUnit ? withUnit.subject ?? "Subject not set" : subjectList[0] ?? ""
  })

  const filteredSubjects = useMemo(
    () => detail.subjects.filter((s) => (s.subject ?? "Subject not set") === selectedSubject),
    [detail, selectedSubject],
  )

  const allUnits = useMemo(() => filteredSubjects.flatMap((s) => s.units), [filteredSubjects])

  // The side menu lists units under the class (group) they were taught to,
  // newest class first (numbers compared as numbers, so 25-10 sorts above
  // 25-8). A unit taught to more than one class appears under each;
  // selecting it still shows the whole unit.
  const unitsByGroup = useMemo(() => {
    const byGroup = new Map<string, PupilUnitEntry[]>()
    for (const unit of allUnits) {
      const groupIds = [...new Set(unit.lessons.map((lesson) => lesson.groupId))]
      for (const groupId of groupIds) {
        const units = byGroup.get(groupId) ?? []
        units.push(unit)
        byGroup.set(groupId, units)
      }
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
      .map(([groupId, units]) => ({ groupId, units }))
  }, [allUnits])
  // Null means the first unit of the newest class (the top of the side menu).
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(initialUnitId)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const selectedUnit = useMemo(() => {
    const found = allUnits.find((u) => u.unitId === selectedUnitId)
    return found ?? unitsByGroup[0]?.units[0] ?? null
  }, [allUnits, unitsByGroup, selectedUnitId])

  const chooseSubject = (subject: string) => {
    setSelectedSubject(subject)
    setSelectedUnitId(null)
    setSelectedGroupId(null)
  }

  const subjectSelect = (id: string) => (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Subject
      </label>
      <select id={id} value={selectedSubject} onChange={(event) => chooseSubject(event.target.value)} className={selectClass}>
        {subjectList.map((subject) => (
          <option key={subject} value={subject}>
            {subject}
          </option>
        ))}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-la-muted" />
    </div>
  )

  return (
    <div className={cn("lesson-article min-h-screen bg-la-bg font-[family-name:var(--font-inter)] text-[16px] text-la-ink", lessonArticleFontClass)}>
      <div className="mx-auto w-full max-w-[1040px] px-4 pb-24 pt-8 sm:px-6 min-[900px]:pt-10">
        {picker && (
          <div className="mb-6">
            <PupilPicker {...picker} basePath="/pupil-lessons" pupilIn="path" />
          </div>
        )}

        <div className="flex flex-col min-[900px]:flex-row min-[900px]:gap-12">
          {/* Side menu: subject, then the units by class. */}
          <aside
            aria-label="Your units"
            className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-60 flex-none self-start overflow-y-auto pb-8 min-[900px]:block"
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-la-muted">Subject</p>
            {subjectSelect("subject-select")}
            <nav aria-label="Units" className="mt-6 space-y-5 text-sm">
              {unitsByGroup.map(({ groupId, units }) => (
                <div key={groupId}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-la-muted">{groupId}</p>
                  <ul className="space-y-0.5">
                    {units.map((unit) => {
                      const resubmitLessons = unit.lessons.filter((l) => l.resubmitCount > 0).length
                      const underperformingLessons = unit.lessons.filter(isLessonOverdueAndUnderperforming).length
                      // Highlight only the entry clicked, not every copy of a unit in two classes.
                      const isActive =
                        unit.unitId === selectedUnit?.unitId &&
                        (selectedGroupId === null
                          ? groupId === unitsByGroup.find((g) => g.units.includes(unit))?.groupId
                          : groupId === selectedGroupId)
                      return (
                        <li key={`${groupId}::${unit.unitId}`}>
                          <button
                            type="button"
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => {
                              setSelectedUnitId(unit.unitId)
                              setSelectedGroupId(groupId)
                            }}
                            className={cn(
                              "flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-la-green",
                              isActive ? "bg-la-green-pale font-semibold text-la-ink" : "text-la-ink hover:bg-la-border/50",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate" title={unit.unitTitle}>
                              {unit.unitTitle}
                            </span>
                            {resubmitLessons > 0 ? (
                              <span
                                title={`${resubmitLessons} ${resubmitLessons === 1 ? "lesson needs" : "lessons need"} resubmitting`}
                                className="flex-none rounded-full bg-la-amber-bg px-2 py-0.5 text-xs font-semibold text-la-amber"
                              >
                                {resubmitLessons}
                                <span className="sr-only"> to resubmit</span>
                              </span>
                            ) : null}
                            {underperformingLessons > 0 ? (
                              <span
                                title={`${underperformingLessons} overdue ${underperformingLessons === 1 ? "lesson" : "lessons"} below 80%`}
                                className="flex-none rounded-full bg-la-red-bg px-2 py-0.5 text-xs font-semibold text-la-red"
                              >
                                {underperformingLessons}
                                <span className="sr-only"> overdue below 80%</span>
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          <main className="min-w-0 max-w-[720px] flex-1">
            {/* Phones choose a subject and a unit from two selects instead of the side menu. */}
            <div className="mb-8 grid gap-3 min-[900px]:hidden">
              {subjectSelect("subject-select-mobile")}
              <div className="relative">
                <label htmlFor="unit-select" className="sr-only">
                  Unit
                </label>
                <select
                  id="unit-select"
                  value={selectedUnit?.unitId ?? ""}
                  onChange={(event) => {
                    setSelectedUnitId(event.target.value || null)
                    setSelectedGroupId(null)
                  }}
                  className={selectClass}
                >
                  {allUnits.length === 0 ? (
                    <option value="" disabled>
                      No units
                    </option>
                  ) : (
                    unitsByGroup.map(({ groupId, units }) => (
                      <optgroup key={groupId} label={groupId}>
                        {units.map((unit) => (
                          // A unit in two classes is listed twice; either option selects it.
                          <option key={`${groupId}::${unit.unitId}`} value={unit.unitId}>
                            {unit.unitTitle}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  )}
                </select>
                <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-la-muted" />
              </div>
            </div>

            <header>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-la-green">
                My units · {selectedSubject}
              </p>
              <h1 className="mt-3 text-balance font-[family-name:var(--font-source-serif)] text-[38px] font-semibold leading-[1.1] tracking-tight sm:text-[56px]">
                {selectedUnit?.unitTitle ?? "My units"}
              </h1>
              {selectedUnit ? <UnitMeta unit={selectedUnit} /> : null}
              <p className="mt-2 text-[15px] text-la-muted">Units and lessons set for {detail.pupilName}.</p>
            </header>

            {selectedUnit === null ? (
              <p className="mt-12 text-la-muted">No units have been set yet.</p>
            ) : (
              <ol className="mt-10 space-y-4" aria-label={`Lessons in ${selectedUnit.unitTitle}`}>
                {selectedUnit.lessons.map((lesson, index) => (
                  <LessonCard
                    key={lesson.lessonId}
                    lesson={lesson}
                    number={selectedUnit.lessons.length - index}
                    pupilId={detail.pupilId}
                  />
                ))}
              </ol>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function UnitMeta({ unit }: { unit: PupilUnitEntry }) {
  const parts: ReactNode[] = []
  const first = formatDate(unit.firstLessonDate)
  if (first) parts.push(`First lesson ${first}`)
  parts.push(`${unit.lessons.length} ${unit.lessons.length === 1 ? "lesson" : "lessons"}`)
  if (unit.unitScore != null && unit.unitMaxScore != null && unit.unitMaxScore > 0) {
    parts.push(
      <span className="rounded-full bg-la-green-pale px-2.5 py-0.5 font-semibold text-la-green">
        Unit score {Math.round(unit.unitScore * 10) / 10}/{unit.unitMaxScore} (
        {Math.round((unit.unitScore / unit.unitMaxScore) * 100)}%)
      </span>,
    )
  }
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-la-muted">
      {parts.map((part, index) => (
        // The separator ends the item before it, so a wrapped line never starts with one.
        <span key={index} className="inline-flex items-center gap-3">
          {part}
          {index < parts.length - 1 ? <span aria-hidden="true">·</span> : null}
        </span>
      ))}
    </p>
  )
}

function LessonCard({ lesson, number, pupilId }: { lesson: PupilUnitLesson; number: number; pupilId: string }) {
  const due = lessonDueDate(lesson.startDate)
  const behind = isLessonOverdueAndUnderperforming(lesson)
  const hasScore = lesson.lessonScore !== null && lesson.lessonMaxScore !== null && lesson.lessonMaxScore > 0
  const revision =
    lesson.isEnrolled && lesson.revisionScore !== null && lesson.revisionMaxScore !== null && lesson.revisionMaxScore > 0
  const tone = revisionTone(lesson.revisionDate)

  return (
    <li
      className={cn(
        "rounded-xl border bg-la-card p-5",
        behind ? "border-la-red/40" : "border-la-border",
      )}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 flex-none place-items-center rounded-full bg-la-green-pale text-sm font-semibold text-la-green"
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <h2 className="text-[20px] font-semibold leading-snug">
              {lesson.isEnrolled ? (
                // A locked lesson still opens (read-only), so it keeps its link.
                <Link
                  href={`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lesson.lessonId)}`}
                  className="inline-flex items-center gap-2 text-la-ink underline-offset-4 hover:text-la-green hover:underline focus-visible:outline-2 focus-visible:outline-la-green"
                >
                  {lesson.lessonTitle}
                  {lesson.locked ? <LockIcon className="h-4 w-4 flex-none text-la-amber" aria-label="Locked: view only" /> : null}
                </Link>
              ) : (
                lesson.lessonTitle
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {due ? (
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5",
                    behind ? "bg-la-red-bg font-semibold text-la-red" : "text-la-muted",
                  )}
                >
                  {behind ? "Overdue · " : ""}Due {formatDate(due, "EEE d MMM yyyy")}
                </span>
              ) : (
                <span className="text-la-muted">No due date</span>
              )}
              {hasScore ? (
                <span className="rounded-full bg-la-green-pale px-2.5 py-0.5 text-xs font-semibold text-la-green">
                  {Math.round(lesson.lessonScore! * 10) / 10}/{lesson.lessonMaxScore} ({Math.round(lesson.lessonScorePercentage ?? 0)}%)
                </span>
              ) : null}
              {typeof lesson.avgSubmissionsPerActivity === "number" && lesson.avgSubmissionsPerActivity > 0 ? (
                <span
                  className="rounded-full bg-la-border/60 px-2.5 py-0.5 text-xs font-medium text-la-muted"
                  title="Average attempts per activity"
                >
                  {lesson.avgSubmissionsPerActivity === 1 ? "avg 1 attempt" : `avg ${lesson.avgSubmissionsPerActivity} attempts`}
                </span>
              ) : null}
            </div>
          </div>

          <p className="mt-1 text-[15px] text-la-muted">
            {lesson.objectives.length > 0 ? lesson.objectives.map((objective) => objective.title).join(" · ") : "No learning objectives set"}
          </p>

          {lesson.resubmitCount > 0 ? (
            <p className="mt-3 inline-flex rounded-full bg-la-amber-bg px-2.5 py-0.5 text-sm font-medium text-la-amber">
              {lesson.resubmitCount} {lesson.resubmitCount === 1 ? "activity needs" : "activities need"} resubmitting
            </p>
          ) : null}

          <LessonMedia lessonId={lesson.lessonId} lessonTitle={lesson.lessonTitle} images={lesson.displayImages} files={lesson.files} />

          {revision ? (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-medium",
                  tone === "red" && "bg-la-red-bg text-la-red",
                  tone === "amber" && "bg-la-amber-bg text-la-amber",
                  tone === "ok" && "bg-la-green-pale text-la-green",
                )}
              >
                Revision {Math.round(lesson.revisionScore! * 10) / 10}/{lesson.revisionMaxScore} (
                {Math.round((lesson.revisionScore! / lesson.revisionMaxScore!) * 100)}%)
              </span>
              {lesson.revisionDate ? <span className="text-la-muted">Last revised {formatDate(lesson.revisionDate)}</span> : null}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  )
}
