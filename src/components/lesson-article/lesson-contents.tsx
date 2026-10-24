"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { CourseUnit } from "@/lib/pupil-lesson-article-data"
import { CheckIcon, ChevronIcon, ListIcon } from "./icons"
import { useLessonProgress } from "./lesson-progress"

export type ContentsSection = {
  anchorId: string
  number: number
  title: string
  items: Array<{ activityId: string; anchorId: string; title: string; countable: boolean }>
}

export interface LessonContentsProps {
  sections: ContentsSection[]
  /** Marks awarded, or null while they are not released. */
  awarded: number | null
  totalMarks: number
  course: { units: CourseUnit[]; pupilId: string } | null
  fontClass: string
}

/**
 * The lesson's side menu: its sections (each opening to its activities), the
 * pupil's progress and score, and the course's units. A column beside the
 * article on desktop; below 900px a "Contents" button opens it as a drawer,
 * with a slim progress bar that stays at the top.
 */
export function LessonContents(props: LessonContentsProps) {
  const { sections } = props
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { doneCount, total } = useLessonProgress()

  // The section in view is highlighted. Opening and closing is the pupil's alone.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return
    const elements = sections
      .map((section) => document.getElementById(section.anchorId))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top)
          else visible.delete(entry.target.id)
        }
        const current = [...visible.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
        if (current) setActiveSection(current)
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: 0 },
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [sections])

  const toggle = (anchorId: string) =>
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(anchorId)) next.delete(anchorId)
      else next.add(anchorId)
      return next
    })

  const panel = (
    <ContentsPanel
      {...props}
      activeSection={activeSection}
      open={open}
      onToggle={toggle}
      onNavigate={() => setDrawerOpen(false)}
    />
  )

  return (
    <>
      <aside
        aria-label="Lesson contents"
        className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-60 flex-none self-start overflow-y-auto pb-8 min-[900px]:block"
      >
        {panel}
      </aside>

      <div className="sticky top-20 z-30 -mx-4 border-b border-la-border bg-la-bg/95 px-4 backdrop-blur min-[900px]:hidden">
        <div className="flex items-center justify-between gap-3 py-1.5">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-la-border bg-la-card px-3 text-sm font-semibold text-la-ink focus-visible:outline-2 focus-visible:outline-la-green"
              >
                <ListIcon className="h-4 w-4" />
                Contents
              </button>
            </SheetTrigger>
            <SheetContent side="left" className={cn("lesson-article w-[300px] overflow-y-auto bg-la-bg p-5 font-[family-name:var(--font-inter)]", props.fontClass)}>
              <SheetTitle className="sr-only">Lesson contents</SheetTitle>
              <SheetDescription className="sr-only">Sections of this lesson and the units in your course</SheetDescription>
              <div className="pt-6">{panel}</div>
            </SheetContent>
          </Sheet>
          <span className="text-sm text-la-muted">
            {doneCount} of {total} done
          </span>
        </div>
        <ProgressBar value={total > 0 ? doneCount / total : 0} className="absolute inset-x-0 bottom-0 h-[3px] rounded-none" />
      </div>
    </>
  )
}

function ContentsPanel({
  sections,
  awarded,
  totalMarks,
  course,
  activeSection,
  open,
  onToggle,
  onNavigate,
}: LessonContentsProps & {
  activeSection: string | null
  open: ReadonlySet<string>
  onToggle: (anchorId: string) => void
  onNavigate: () => void
}) {
  const { done, doneCount, total } = useLessonProgress()

  return (
    <nav aria-label="In this lesson" className="text-sm text-la-ink">
      <dl className="mb-5 space-y-3 border-b border-la-border pb-4">
        <div>
          <div className="flex justify-between">
            <dt className="text-la-muted">Progress</dt>
            <dd className="font-semibold">
              {doneCount} of {total} done
            </dd>
          </div>
          <ProgressBar value={total > 0 ? doneCount / total : 0} className="mt-2" />
        </div>
        <div className="flex justify-between">
          <dt className="text-la-muted">Score</dt>
          <dd className="font-semibold tabular-nums">
            {awarded === null ? "–" : awarded} / {totalMarks}
          </dd>
        </div>
        {awarded === null && totalMarks > 0 ? (
          <div className="text-xs text-la-muted">
            <dt className="sr-only">Note</dt>
            <dd>Your score appears when your teacher releases feedback.</dd>
          </div>
        ) : null}
      </dl>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-la-muted">In this lesson</p>
      <ul className="space-y-0.5">
        {sections.map((section) => {
          const isOpen = open.has(section.anchorId)
          const isActive = activeSection === section.anchorId
          const listId = `${section.anchorId}-contents`
          return (
            <li key={section.anchorId}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={listId}
                onClick={() => onToggle(section.anchorId)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-la-green",
                  isActive ? "bg-la-green-pale font-semibold text-la-ink" : "hover:bg-la-border/50",
                )}
              >
                <span className="flex-1">
                  <span className={cn("mr-1", isActive ? "text-la-green" : "text-la-muted")}>{section.number} ·</span>
                  {section.title}
                </span>
                <span className="text-xs text-la-muted">{section.items.length}</span>
                <ChevronIcon className={cn("h-4 w-4 text-la-muted transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen ? (
                <ul id={listId} className="mb-1 ml-3 border-l border-la-border pl-2">
                  {section.items.map((item) => {
                    const isDone = done.has(item.activityId)
                    return (
                      <li key={item.activityId}>
                        <a
                          href={`#${item.anchorId}`}
                          onClick={onNavigate}
                          className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-la-muted hover:bg-la-border/50 hover:text-la-ink focus-visible:outline-2 focus-visible:outline-la-green"
                        >
                          {item.countable ? (
                            <span
                              className={cn(
                                "grid h-4 w-4 flex-none place-items-center rounded-full border",
                                isDone ? "border-la-green bg-la-green text-white" : "border-la-input",
                              )}
                            >
                              {isDone ? <CheckIcon className="h-3 w-3" strokeWidth={2.5} /> : null}
                              <span className="sr-only">{isDone ? "Done" : "Not done"}</span>
                            </span>
                          ) : (
                            <span className="h-4 w-4 flex-none" aria-hidden="true" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>


      {course && course.units.length > 0 ? <CourseList {...course} onNavigate={onNavigate} /> : null}
    </nav>
  )
}

function CourseList({ units, pupilId, onNavigate }: { units: CourseUnit[]; pupilId: string; onNavigate: () => void }) {
  const currentIndex = units.findIndex((unit) => unit.status === "current")
  return (
    <div className="mt-6 border-t border-la-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-la-muted">Course</p>
      {currentIndex >= 0 ? (
        <p className="mb-2 mt-1 text-xs text-la-muted">
          Unit {currentIndex + 1} of {units.length}
        </p>
      ) : null}
      <ul className="mt-2 space-y-0.5">
        {units.map((unit) => {
          const current = unit.status === "current"
          return (
            <li key={unit.unitId}>
              <Link
                href={`/pupil-lessons/${encodeURIComponent(pupilId)}?unit=${encodeURIComponent(unit.unitId)}`}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-la-border/50 focus-visible:outline-2 focus-visible:outline-la-green",
                  current && "bg-la-green-pale font-semibold hover:bg-la-green-pale",
                )}
              >
                <StatusMarker status={unit.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{unit.title}</span>
                  <span className="block text-xs font-normal text-la-muted">
                    {unit.firstLessonDate ? format(parseISO(unit.firstLessonDate), "d MMM yyyy") : "No date set"}
                  </span>
                </span>
                {unit.overdueLessons > 0 && unit.status !== "upcoming" ? (
                  <span className="flex-none rounded-full bg-la-red-bg px-2 py-0.5 text-xs font-semibold text-la-red">
                    {unit.overdueLessons}
                    <span className="sr-only"> overdue {unit.overdueLessons === 1 ? "lesson" : "lessons"}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const STATUS_LABEL: Record<CourseUnit["status"], string> = {
  done: "Done",
  current: "Current unit",
  upcoming: "Upcoming",
  behind: "Behind",
  "in-progress": "In progress",
}

function StatusMarker({ status }: { status: CourseUnit["status"] }) {
  return (
    <span
      title={STATUS_LABEL[status]}
      className={cn(
        "grid h-4 w-4 flex-none place-items-center rounded-full border",
        status === "done" && "border-la-green bg-la-green text-white",
        status === "current" && "border-la-green bg-la-card ring-2 ring-la-green/30",
        status === "upcoming" && "border-dashed border-la-input",
        status === "behind" && "border-la-red bg-la-red-bg",
        status === "in-progress" && "border-la-green bg-[linear-gradient(90deg,var(--la-green)_50%,transparent_50%)]",
      )}
    >
      {status === "done" ? <CheckIcon className="h-3 w-3" strokeWidth={2.5} /> : null}
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  )
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label="Lesson progress"
      className={cn("h-1.5 overflow-hidden rounded-full bg-la-border", className)}
    >
      <div className="h-full bg-la-green transition-[width] duration-300" style={{ width: `${value * 100}%` }} />
    </div>
  )
}
