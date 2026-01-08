"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { ChevronDown } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createWildcardRegex } from "@/lib/search"
import type { PupilLessonsSummary } from "@/lib/pupil-lessons-data"

type PupilLessonsViewProps = {
  pupils: PupilLessonsSummary[]
  showFilter?: boolean
  linkNames?: boolean
  lessonLinkFactory?: (pupilId: string, lessonId: string) => string
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return "No start date"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return format(parsed, "PPP")
}

const defaultLessonLink = (pupilId: string, lessonId: string) =>
  `/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lessonId)}`

function PupilLessonsCard({
  pupil,
  linkName = true,
  lessonLinkFactory = defaultLessonLink,
}: {
  pupil: PupilLessonsSummary
  linkName?: boolean
  lessonLinkFactory?: (pupilId: string, lessonId: string) => string
}) {
  return (
    <Card key={pupil.pupilId}>
      <CardHeader className="flex flex-col gap-2">
        <CardTitle className="text-xl font-semibold text-foreground">
          {linkName ? (
            <Link href={`/pupil-lessons/${encodeURIComponent(pupil.pupilId)}`} className="underline-offset-4 hover:underline">
              {pupil.name}
            </Link>
          ) : (
            <span>{pupil.name}</span>
          )}
        </CardTitle>
        <div className="text-sm text-muted-foreground">Groups: {pupil.groups.join(", ") || "None"}</div>
      </CardHeader>
      <CardContent className="space-y-6">
        {pupil.sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lessons assigned.</p>
        ) : (
          pupil.sections.map((section) => (
            <div key={section.date || "no-date"} className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{formatDateLabel(section.date)}</h3>
              <div className="space-y-4">
                {section.groups.map((group) => {
                  const groupLabel = group.subject ? `${group.groupId} · ${group.subject}` : group.groupId

                  return (
                    <div key={group.groupId} className="space-y-2">
                      <h4 className="text-sm font-medium text-foreground">{groupLabel}</h4>
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        {group.lessons.map((lesson) => (
                          <li key={lesson.lessonId} className="flex items-center justify-between gap-2">
                            <Link
                              href={lessonLinkFactory(pupil.pupilId, lesson.lessonId)}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {lesson.title}
                            </Link>
                            <span className="text-xs text-muted-foreground">Unit {lesson.unitId}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function PupilLessonsView({
  pupils,
  showFilter = true,
  linkNames = true,
  lessonLinkFactory = defaultLessonLink,
}: PupilLessonsViewProps) {
  const [filter, setFilter] = useState("")
  const [selectedSubject, setSelectedSubject] = useState("All Subjects")

  const subjects = useMemo(() => {
    const subjectSet = new Set<string>()
    pupils.forEach((pupil) => {
      pupil.sections.forEach((section) => {
        section.groups.forEach((group) => {
          if (group.subject) {
            subjectSet.add(group.subject)
          }
        })
      })
    })
    return ["All Subjects", ...Array.from(subjectSet).sort()]
  }, [pupils])

  const filtered = useMemo(() => {
    let result = pupils

    if (selectedSubject !== "All Subjects") {
      result = result
        .map((pupil) => ({
          ...pupil,
          sections: pupil.sections
            .map((section) => ({
              ...section,
              groups: section.groups.filter((group) => group.subject === selectedSubject),
            }))
            .filter((section) => section.groups.length > 0),
        }))
        .filter((pupil) => pupil.sections.length > 0)
    }

    if (!showFilter) {
      return result
    }

    const trimmed = filter.trim()
    if (!trimmed) return result

    try {
      const regex = createWildcardRegex(trimmed)
      return result.filter((pupil) => regex.test(pupil.name) || pupil.groups.some((groupId) => regex.test(groupId)))
    } catch (error) {
      console.error("[pupil-lessons] Invalid filter", error)
      return []
    }
  }, [filter, pupils, showFilter, selectedSubject])

  return (
    <div className="space-y-6">
      {showFilter ? (
        <div className="space-y-6">
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

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-foreground" htmlFor="pupil-lessons-filter">
              Filter by pupil name or group
            </label>
            <input
              id="pupil-lessons-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Type a pupil or group (use '?' as wildcard)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pupils match this filter.</p>
      ) : (
        filtered.map((pupil) => (
          <PupilLessonsCard
            key={pupil.pupilId}
            pupil={pupil}
            linkName={linkNames}
            lessonLinkFactory={lessonLinkFactory}
          />
        ))
      )}
    </div>
  )
}
