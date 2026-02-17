"use client"

import type React from "react"
import { useMemo, useRef, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Group, Unit, Assignment, Lesson, LessonAssignment, LessonAssignmentScoreSummary, DateComment } from "@/types"
import { normalizeDateOnly } from "@/lib/utils"
import { Eye, EyeOff } from "lucide-react"


interface AssignmentGridProps {
  groups: Group[]
  units: Unit[]
  assignments: Assignment[]
  lessons: Lesson[]
  lessonAssignments: LessonAssignment[]
  lessonScoreSummaries: LessonAssignmentScoreSummary[]
  onAssignmentClick?: (assignment: Assignment) => void
  onEmptyCellClick?: (groupId: string, weekStart: Date) => void
  onAddGroupClick?: () => void // Changed from onAddGroup to onAddGroupClick to trigger sidebar
  onGroupTitleClick?: (groupId: string) => void // Added prop for group title click
  onToggleHidden?: (groupId: string, lessonId: string, currentHidden: boolean) => void
  onDateClick?: (dateString: string) => void
  dateCommentsByDate?: Map<string, DateComment[]>
}

interface TrackCell {
  groupId: string
  weekStart: Date
  assignment?: Assignment & { unit: Unit }
  colSpan: number
  isStart: boolean
  trackIndex: number
}

interface GroupRow {
  groupId: string
  tracks: TrackCell[][]
}

const toDayNumber = (value: string | Date | null | undefined) => {
  const normalized = normalizeDateOnly(value)
  if (!normalized) {
    return null
  }

  const [year, month, day] = normalized.split("-").map(Number)
  if (![year, month, day].every((part) => Number.isFinite(part))) {
    return null
  }

  return Date.UTC(year, month - 1, day)
}
const POSITIVE_SEGMENT_COLOR = "#bbf7d0"
const NEGATIVE_SEGMENT_COLOR = "#fecaca"
const UNMARKED_SEGMENT_COLOR = "#e5e7eb"
const LESSON_TITLE_COLOR = "#0f172a"
const LESSON_DETAIL_COLOR = "#334155"
const GROUP_COLUMN_WIDTH = "12rem"
const WEEK_COLUMN_WIDTH = "8rem"
const GRID_FIXED_START_DAY = null // 14 Sept 2025 UTC

export function AssignmentGrid({
  groups,
  units,
  assignments,
  lessons,
  lessonAssignments,
  lessonScoreSummaries,
  onAssignmentClick,
  onEmptyCellClick,
  onAddGroupClick, // Updated prop name
  onGroupTitleClick, // Added onGroupTitleClick prop
  onToggleHidden,
  onDateClick,
  dateCommentsByDate,
}: AssignmentGridProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const scoreSummaryMap = useMemo(() => {
    const map = new Map<string, LessonAssignmentScoreSummary>()
    lessonScoreSummaries.forEach((summary) => {
      map.set(`${summary.group_id}::${summary.lesson_id}`, summary)
    })
    return map
  }, [lessonScoreSummaries])

  const normalizedLessonAssignments = useMemo(
    () =>
      lessonAssignments.map((entry) => ({
        ...entry,
        start_date: normalizeDateOnly(entry.start_date) ?? entry.start_date,
      })),
    [lessonAssignments],
  )

  const { weekStarts, gridData } = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000

    const assignmentDayRanges = assignments
      .map((a) => {
        const start = toDayNumber(a.start_date)
        const end = toDayNumber(a.end_date)
        if (start === null || end === null) return null
        return { start, end }
      })
      .filter((range): range is { start: number; end: number } => range !== null)

    const minStartDay = assignmentDayRanges.reduce<number | null>(
      (acc, range) => (acc === null || range.start < acc ? range.start : acc),
      null,
    )
    const maxEndDay = assignmentDayRanges.reduce<number | null>(
      (acc, range) => (acc === null || range.end > acc ? range.end : acc),
      null,
    )

    const today = new Date()
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    const startDay = GRID_FIXED_START_DAY || minStartDay || todayDay
    const bufferWeeks = 5 * 7 * dayMs
    const endDay = Math.max((maxEndDay ?? startDay) + bufferWeeks, startDay + 12 * 7 * dayMs)

    const startDateUtc = new Date(startDay)
    const current = new Date(
      Date.UTC(startDateUtc.getUTCFullYear(), startDateUtc.getUTCMonth(), startDateUtc.getUTCDate()),
    )
    current.setUTCHours(0, 0, 0, 0)
    // Set to start of week (Sunday, UTC)
    current.setUTCDate(current.getUTCDate() - current.getUTCDay())
    current.setUTCHours(0, 0, 0, 0)

    const weekStarts: Date[] = []

    while (current.getTime() <= endDay) {
      weekStarts.push(new Date(current))
      current.setUTCDate(current.getUTCDate() + 7)
      current.setUTCHours(0, 0, 0, 0)
    }

    console.log("[AssignmentGrid] Debug:", {
      groupsCount: groups.length,
      assignmentsCount: assignments.length,
      GRID_FIXED_START_DAY,
      minStartDay: minStartDay ? new Date(minStartDay).toISOString() : null,
      todayDay: new Date(todayDay).toISOString(),
      startDay: new Date(startDay).toISOString(),
      endDay: new Date(endDay).toISOString(),
      weekStartsCount: weekStarts.length,
      firstWeek: weekStarts[0]?.toISOString(),
    })

    const gridData: GroupRow[] = groups.map((group) => {
      const groupAssignments = assignments
        .filter((a) => a.group_id === group.group_id)
        .map((a) => {
          const unit =
            units.find((u) => u.unit_id === a.unit_id) ??
            ({
              unit_id: a.unit_id,
              title: a.unit_id,
              description: null,
              subject: "Unknown",
              year: null,
              active: true,
            } as Unit)
          return {
            ...a,
            unit,
          }
        })
        .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())

      if (groupAssignments.length === 0) {
        const emptyTrack: TrackCell[] = weekStarts.map((weekStart) => ({
          groupId: group.group_id,
          weekStart,
          colSpan: 1,
          isStart: true,
          trackIndex: 0,
        }))

        return {
          groupId: group.group_id,
          tracks: [emptyTrack],
        }
      }

      const tracks: TrackCell[][] = []

      const datesOverlapDays = (start1: number, end1: number, start2: number, end2: number) => {
        return start1 <= end2 && end1 >= start2
      }

      groupAssignments.forEach((assignment) => {
        const assignmentStartDay = toDayNumber(assignment.start_date)
        const assignmentEndDay = toDayNumber(assignment.end_date)
        if (assignmentStartDay === null || assignmentEndDay === null) {
          return
        }

        let trackIndex = 0
        let foundTrack = false

        while (!foundTrack) {
          if (!tracks[trackIndex]) {
            tracks[trackIndex] = []
            foundTrack = true
          } else {
            const hasOverlap = tracks[trackIndex].some((cell) => {
              if (!cell.assignment) return false
              const cellStartDay =
                toDayNumber(cell.assignment.start_date) ?? toDayNumber(new Date(cell.assignment.start_date))
              const cellEndDay =
                toDayNumber(cell.assignment.end_date) ?? toDayNumber(new Date(cell.assignment.end_date))
              if (cellStartDay === null || cellEndDay === null) return false
              return datesOverlapDays(assignmentStartDay, assignmentEndDay, cellStartDay, cellEndDay)
            })

            if (!hasOverlap) {
              foundTrack = true
            } else {
              trackIndex++
            }
          }
        }

        const assignmentCells: TrackCell[] = []

        for (let i = 0; i < weekStarts.length; i++) {
          const weekStartDate = weekStarts[i]
          const weekStartDay = toDayNumber(weekStartDate)!
          const weekEndDay = weekStartDay + 6 * 24 * 60 * 60 * 1000

          if (datesOverlapDays(assignmentStartDay, assignmentEndDay, weekStartDay, weekEndDay)) {
            const isStart = assignmentCells.length === 0

            if (isStart) {
              let colSpan = 1
              for (let j = i + 1; j < weekStarts.length; j++) {
                const nextWeekStartDay = toDayNumber(weekStarts[j])!
                const nextWeekEndDay = nextWeekStartDay + 6 * 24 * 60 * 60 * 1000

                if (datesOverlapDays(assignmentStartDay, assignmentEndDay, nextWeekStartDay, nextWeekEndDay)) {
                  colSpan++
                } else {
                  break
                }
              }

              assignmentCells.push({
                groupId: group.group_id,
                weekStart: weekStartDate, // use the same instance used in weekStarts for accurate matching
                assignment,
                colSpan,
                isStart: true,
                trackIndex,
              })

              i += colSpan - 1
            }
          }
        }

        tracks[trackIndex].push(...assignmentCells)
      })

      const maxTracks = Math.max(1, tracks.length)
      const filledTracks: TrackCell[][] = []

      for (let trackIndex = 0; trackIndex < maxTracks; trackIndex++) {
        const track = tracks[trackIndex] || []
        const filledTrack: TrackCell[] = []

        for (let i = 0; i < weekStarts.length; i++) {
          const weekStart = weekStarts[i]

          const existingCell = track.find((cell) => {
            const cellWeekStart = new Date(cell.weekStart)
            return cellWeekStart.getTime() === weekStart.getTime() && cell.isStart
          })

          if (existingCell) {
            filledTrack.push(existingCell)
            i += existingCell.colSpan - 1
          } else {
            const isCovered = track.some((cell) => {
              if (!cell.assignment || !cell.isStart) return false
              const cellStart = new Date(cell.weekStart)
              const cellEndWeek = new Date(cellStart)
              cellEndWeek.setDate(cellEndWeek.getDate() + cell.colSpan * 7 - 1)
              return weekStart >= cellStart && weekStart <= cellEndWeek && cellStart.getTime() !== weekStart.getTime()
            })

            if (!isCovered) {
              filledTrack.push({
                groupId: group.group_id,
                weekStart,
                colSpan: 1,
                isStart: true,
                trackIndex,
              })
            }
          }
        }

        filledTracks.push(filledTrack)
      }

      return {
        groupId: group.group_id,
        tracks: filledTracks,
      }
    })

    return { weekStarts, gridData }
  }, [assignments, groups, units])

  const weekStartIndexLookup = useMemo(() => {
    const map = new Map<number, number>()
    weekStarts.forEach((weekStart, index) => {
      const dayNumber = toDayNumber(weekStart)
      if (dayNumber !== null) {
        map.set(dayNumber, index)
      }
    })
    return map
  }, [weekStarts])

  const lessonsByUnit = useMemo(() => {
    const map = new Map<string, Lesson[]>()
    lessons.forEach((lesson) => {
      if (!map.has(lesson.unit_id)) {
        map.set(lesson.unit_id, [])
      }
      map.get(lesson.unit_id)!.push(lesson)
    })

    map.forEach((lessonList) => {
      lessonList.sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    })

    return map
  }, [lessons])

  const lessonAssignmentsByGroup = useMemo(() => {
    const map = new Map<string, Map<string, LessonAssignment>>()

    normalizedLessonAssignments.forEach((lessonAssignment) => {
      if (!map.has(lessonAssignment.group_id)) {
        map.set(lessonAssignment.group_id, new Map())
      }

      map.get(lessonAssignment.group_id)!.set(lessonAssignment.lesson_id, lessonAssignment)
    })

    return map
  }, [normalizedLessonAssignments])

  const formatWeekStart = (date: Date) => {
    return normalizeDateOnly(date) ?? date.toISOString().slice(0, 10)
  }

  const formatShortDate = (dateString: string) => {
    return normalizeDateOnly(dateString) ?? dateString
  }

  const getLessonsByWeekForCell = (cell: TrackCell) => {
    if (!cell.assignment) {
      return []
    }

    const { assignment } = cell
    const unitId = assignment.unit.unit_id ?? assignment.unit_id
    const unitLessons = lessonsByUnit.get(unitId) ?? []

    if (unitLessons.length === 0) {
      return []
    }

    const groupLessonAssignments = lessonAssignmentsByGroup.get(assignment.group_id)

    if (!groupLessonAssignments) {
      return []
    }

    const assignmentStartDay = toDayNumber(assignment.start_date)
    const assignmentEndDay = toDayNumber(assignment.end_date)
    if (assignmentStartDay === null || assignmentEndDay === null) {
      return []
    }

    const scheduledLessons = unitLessons
      .map((lesson) => {
        const lessonAssignment = groupLessonAssignments.get(lesson.lesson_id)
        if (!lessonAssignment) {
          return null
        }

        const lessonDay = toDayNumber(lessonAssignment.start_date)
        if (lessonDay === null) {
          return null
        }

        if (lessonDay < assignmentStartDay || lessonDay > assignmentEndDay) {
          return null
        }

        return { lesson, assignment: lessonAssignment, day: lessonDay }
      })
      .filter(
        (entry): entry is { lesson: Lesson; assignment: LessonAssignment; day: number } => entry !== null,
      )
      .sort((a, b) => a.day - b.day)

    if (scheduledLessons.length === 0) {
      return []
    }

    const cellWeekStartDay = toDayNumber(cell.weekStart)
    if (cellWeekStartDay === null) {
      return []
    }

    const startIndex = weekStartIndexLookup.get(cellWeekStartDay)

    if (startIndex === undefined) {
      return []
    }

    const lessonsByWeek: {
      weekIndex: number
      lessons: { lesson: Lesson; assignment: LessonAssignment; day: number }[]
    }[] = []

    for (let offset = 0; offset < cell.colSpan; offset++) {
      const weekIndex = startIndex + offset
      const rawWeekStart = weekStarts[weekIndex]

      if (!rawWeekStart) {
        continue
      }

      const weekStartDay = toDayNumber(rawWeekStart)!
      const weekEndDay = weekStartDay + 6 * 24 * 60 * 60 * 1000

      const lessonsForWeek = scheduledLessons.filter(({ day }) => day >= weekStartDay && day <= weekEndDay)
      lessonsByWeek.push({ weekIndex, lessons: lessonsForWeek })
    }

    return lessonsByWeek
  }

  // Effect to scroll to the current week on mount (minus 2 weeks)
  useEffect(() => {
    if (scrollContainerRef.current && weekStarts.length > 0) {
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() - 14)
      const targetTime = targetDate.getTime()
      
      // Find the index of the week that contains our target date, or the first week in the future
      let currentWeekIndex = weekStarts.findIndex((start) => {
        const end = new Date(start)
        end.setDate(end.getDate() + 7)
        return start.getTime() <= targetTime && targetTime < end.getTime()
      })

      // If target date is past all weeks, scroll to the end
      if (currentWeekIndex === -1) {
        if (targetTime > weekStarts[weekStarts.length - 1].getTime()) {
           currentWeekIndex = weekStarts.length - 1
        } else {
           // If target date is before all weeks (unlikely given grid logic), index 0
           currentWeekIndex = 0
        }
      }

      if (currentWeekIndex > 0) {
        // Calculate scroll position: index * 8rem (128px approx)
        // Using offsetWidth of the first column header would be safer if possible, 
        // but 128px is consistent with the CSS constant.
        const scrollAmount = currentWeekIndex * 128 
        scrollContainerRef.current.scrollLeft = scrollAmount
      }
    }
  }, [weekStarts])

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-primary">Assignment Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[calc(100vh-12rem)]" ref={scrollContainerRef}>
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: GROUP_COLUMN_WIDTH }} />
                {weekStarts.map((_, index) => (
                  <col key={index} style={{ width: WEEK_COLUMN_WIDTH }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th
                    className="sticky left-0 top-0 z-20 bg-muted p-3 text-left font-semibold border border-border"
                    style={{ width: GROUP_COLUMN_WIDTH }}
                  >
                    <div className="space-y-2">
                      <div>Group ID</div>
                      <button
                        onClick={onAddGroupClick}
                        className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:bg-primary/90 transition-colors"
                      >
                        + Add Group
                      </button>
                    </div>
                  </th>
                  {weekStarts.map((weekStart, index) => {
                    const dateStr = formatWeekStart(weekStart)
                    const comments = dateCommentsByDate?.get(dateStr) ?? []
                    return (
                      <th
                        key={index}
                        className={`sticky top-0 z-10 p-3 text-center font-semibold border border-border bg-muted ${onDateClick ? "cursor-pointer hover:bg-muted/70 transition-colors" : ""}`}
                        style={{ width: WEEK_COLUMN_WIDTH }}
                        onClick={() => onDateClick?.(dateStr)}
                      >
                        <div className="text-sm">{dateStr}</div>
                        {comments.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {comments.map((c) => (
                              <div
                                key={c.date_comment_id}
                                className="text-xs text-primary font-normal truncate"
                                title={c.comment}
                              >
                                {c.comment}
                              </div>
                            ))}
                          </div>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {gridData.map((groupRow) => {
                  const maxTracks = groupRow.tracks.length
                  return groupRow.tracks.map((track, trackIndex) => (
                    <tr key={`${groupRow.groupId}-${trackIndex}`}>
                      {trackIndex === 0 && (
                        <td
                          rowSpan={maxTracks}
                          className="sticky left-0 bg-background p-3 font-medium border border-border align-top"
                          style={{ width: GROUP_COLUMN_WIDTH }}
                        >
                          <div className="flex flex-col">
                            <button
                              onClick={() => onGroupTitleClick?.(groupRow.groupId)}
                              className="text-left hover:text-primary transition-colors cursor-pointer"
                            >
                              {groupRow.groupId}
                            </button>
                            <div className="text-xs text-muted-foreground mt-1">
                              Join: {groups.find((g) => g.group_id === groupRow.groupId)?.join_code || "N/A"}
                            </div>
                            {maxTracks > 1 && (
                              <span className="text-xs text-muted-foreground mt-1">
                                {maxTracks} track{maxTracks > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {track.map((cell, cellIndex) => {
                        if (!cell.isStart && cell.assignment) return null

                        const lessonsByWeek = cell.assignment ? getLessonsByWeekForCell(cell) : []
                        const hasScheduledLessons = lessonsByWeek.some((entry) => entry.lessons.length > 0)

                        return (
                          <td
                            key={cellIndex}
                            colSpan={cell.colSpan}
                            className={`p-2 align-top border border-border min-h-20 ${
                              cell.assignment
                                ? "bg-primary/10 hover:bg-primary/20 transition-colors cursor-default"
                                : "bg-background hover:bg-muted/50 transition-colors cursor-pointer"
                            }`}
                            onClick={() => {
                              if (!cell.assignment && onEmptyCellClick) {
                                onEmptyCellClick(cell.groupId, cell.weekStart)
                              }
                            }}
                          >
                            {cell.assignment && (
                              <div className="flex h-full flex-col">
                                <div className="flex flex-1 items-center justify-center text-center">
                                  <div className="w-full">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        if (onAssignmentClick) {
                                          onAssignmentClick({
                                            group_id: cell.assignment!.group_id,
                                            unit_id: cell.assignment!.unit_id,
                                            start_date: cell.assignment!.start_date,
                                            end_date: cell.assignment!.end_date,
                                          })
                                        }
                                      }}
                                      className="font-medium text-sm text-slate-900 truncate hover:text-slate-700 transition-colors text-left w-full cursor-pointer"
                                    >
                                      {cell.assignment.unit.title}
                                    </button>
                                    <p className="text-xs text-muted-foreground">
                                      {formatShortDate(cell.assignment.start_date)} –{" "}
                                      {formatShortDate(cell.assignment.end_date)}
                                    </p>
                                  </div>
                                </div>
                                {hasScheduledLessons && (
                                  <div
                                    className="mt-2 grid gap-2"
                                    style={{ gridTemplateColumns: `repeat(${cell.colSpan}, minmax(0, 1fr))` }}
                                  >
                                    {lessonsByWeek.map(({ lessons: weekLessons, weekIndex }) => (
                                      <div key={weekIndex} className="flex flex-col gap-1">
                                        {weekLessons.map(({ lesson, assignment: lessonAssignment }) => {
                                          const summaryKey = `${cell.assignment!.group_id}::${lesson.lesson_id}`
                                          const scoreSummary = scoreSummaryMap.get(summaryKey)
                                          const rawAverage = scoreSummary?.activities_average ?? null
                                          const clampedAverage =
                                            typeof rawAverage === "number" && Number.isFinite(rawAverage)
                                              ? Math.min(1, Math.max(0, rawAverage))
                                              : null
                                          const scorePercent = clampedAverage !== null ? clampedAverage * 100 : null
                                          const gradient =
                                            scorePercent !== null
                                              ? `linear-gradient(to right, ${POSITIVE_SEGMENT_COLOR} 0%, ${POSITIVE_SEGMENT_COLOR} ${scorePercent}%, ${NEGATIVE_SEGMENT_COLOR} ${scorePercent}%, ${NEGATIVE_SEGMENT_COLOR} 100%)`
                                              : `linear-gradient(to right, ${UNMARKED_SEGMENT_COLOR}, ${UNMARKED_SEGMENT_COLOR})`
                                          const scoreLabel =
                                            scorePercent !== null
                                              ? `${scorePercent.toLocaleString()}%`
                                              : null

                                          const resultsAssignmentId = `${cell.assignment!.group_id}__${lesson.lesson_id}`
                                          const isHidden = lessonAssignment.hidden
                                          return (
                                            <div
                                              key={lesson.lesson_id}
                                              className={`block rounded-md border border-border/70 px-2 py-2 text-xs font-medium shadow-sm transition hover:shadow-md relative group ${isHidden ? 'opacity-60 bg-gray-100' : ''}`}
                                              style={{
                                                backgroundImage: isHidden ? undefined : gradient,
                                                backgroundColor: UNMARKED_SEGMENT_COLOR,
                                              }}
                                            >
                                              <div className="flex flex-col gap-2">
                                                <div className="flex justify-between items-start gap-1">
                                                  <Link
                                                    href={`/lessons/${lesson.lesson_id}/activities`}
                                                    className={`truncate text-xs font-semibold hover:underline ${isHidden ? 'text-gray-500 line-through' : ''}`}
                                                    style={{ color: isHidden ? undefined : LESSON_TITLE_COLOR }}
                                                    title={`View activities for ${lesson.title}`}
                                                  >
                                                    {lesson.title}
                                                  </Link>
                                                  {onToggleHidden && (
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation()
                                                        e.preventDefault()
                                                        onToggleHidden(cell.assignment!.group_id, lesson.lesson_id, !!isHidden)
                                                      }}
                                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-black/10 rounded flex-shrink-0"
                                                      title={isHidden ? "Show lesson" : "Hide lesson from pupils"}
                                                    >
                                                       {isHidden ? (
                                                         <EyeOff className="h-3 w-3 text-gray-500" />
                                                       ) : (
                                                         <Eye className="h-3 w-3 text-gray-400" />
                                                       )}
                                                    </button>
                                                  )}
                                                </div>
                                                <Link
                                                  href={`/results/assignments/${encodeURIComponent(resultsAssignmentId)}`}
                                                  className="text-[10px] font-medium hover:underline"
                                                  style={{ color: LESSON_DETAIL_COLOR }}
                                                  title={`View assignment results for ${lesson.title} • ${formatShortDate(lessonAssignment.start_date)}`}
                                                >
                                                  {scoreLabel ? `Total score ${scoreLabel}` : "No score yet"}
                                                </Link>
                                              </div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {!cell.assignment && (
                              <div className="flex items-center justify-center h-full opacity-0 hover:opacity-50 transition-opacity">
                                <div className="text-xs text-muted-foreground">+ Add</div>
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
