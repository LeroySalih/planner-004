"use client"

import type React from "react"
import { useMemo } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Group, Unit, Assignment, Lesson, LessonAssignment, LessonFeedbackSummary } from "@/types"


interface AssignmentGridProps {
  groups: Group[]
  units: Unit[]
  assignments: Assignment[]
  lessons: Lesson[]
  lessonAssignments: LessonAssignment[]
  lessonFeedbackSummaries: LessonFeedbackSummary[]
  onAssignmentClick?: (assignment: Assignment) => void
  onEmptyCellClick?: (groupId: string, weekStart: Date) => void
  onAddGroupClick?: () => void // Changed from onAddGroup to onAddGroupClick to trigger sidebar
  onGroupTitleClick?: (groupId: string) => void // Added prop for group title click
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

const POSITIVE_SEGMENT_COLOR = "#bbf7d0"
const NEGATIVE_SEGMENT_COLOR = "#fecaca"
const UNMARKED_SEGMENT_COLOR = "#e5e7eb"
const LESSON_TITLE_COLOR = "#0f172a"
const LESSON_DETAIL_COLOR = "#334155"
const GROUP_COLUMN_WIDTH = "12rem"
const WEEK_COLUMN_WIDTH = "8rem"

export function AssignmentGrid({
  groups,
  units,
  assignments,
  lessons,
  lessonAssignments,
  lessonFeedbackSummaries,
  onAssignmentClick,
  onEmptyCellClick,
  onAddGroupClick, // Updated prop name
  onGroupTitleClick, // Added onGroupTitleClick prop
}: AssignmentGridProps) {
  const feedbackSummaryMap = useMemo(() => {
    const map = new Map<string, LessonFeedbackSummary>()
    lessonFeedbackSummaries.forEach((summary) => {
      map.set(`${summary.group_id}::${summary.lesson_id}`, summary)
    })
    return map
  }, [lessonFeedbackSummaries])

  const { weekStarts, gridData } = useMemo(() => {
    const startDate = new Date("2025-09-07")
    const endDate = new Date("2026-09-07")

    const weekStarts: Date[] = []
    const current = new Date(startDate)
    // Set to start of week (Sunday)
    current.setDate(current.getDate() - current.getDay())

    while (current <= endDate) {
      weekStarts.push(new Date(current))
      current.setDate(current.getDate() + 7)
    }

    const gridData: GroupRow[] = groups.map((group) => {
      const groupAssignments = assignments
        .filter((a) => a.group_id === group.group_id)
        .map((a) => {
          const unit = units.find((u) => u.unit_id === a.unit_id)
          if (!unit) {
            return null
          }
          return {
            ...a,
            unit,
          }
        })
        .filter((assignment): assignment is Assignment & { unit: Unit } => assignment !== null)
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

      const datesOverlap = (start1: Date, end1: Date, start2: Date, end2: Date) => {
        return start1 <= end2 && end1 >= start2
      }

      groupAssignments.forEach((assignment) => {
        const assignmentStart = new Date(assignment.start_date)
        const assignmentEnd = new Date(assignment.end_date)

        let trackIndex = 0
        let foundTrack = false

        while (!foundTrack) {
          if (!tracks[trackIndex]) {
            tracks[trackIndex] = []
            foundTrack = true
          } else {
            const hasOverlap = tracks[trackIndex].some((cell) => {
              if (!cell.assignment) return false
              const cellStart = new Date(cell.assignment.start_date)
              const cellEnd = new Date(cell.assignment.end_date)
              return datesOverlap(assignmentStart, assignmentEnd, cellStart, cellEnd)
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
          const weekStart = weekStarts[i]
          const weekEnd = new Date(weekStart)
          weekEnd.setDate(weekEnd.getDate() + 6)

          if (datesOverlap(assignmentStart, assignmentEnd, weekStart, weekEnd)) {
            const isStart = assignmentCells.length === 0

            if (isStart) {
              let colSpan = 1
              for (let j = i + 1; j < weekStarts.length; j++) {
                const nextWeekStart = weekStarts[j]
                const nextWeekEnd = new Date(nextWeekStart)
                nextWeekEnd.setDate(nextWeekEnd.getDate() + 6)

                if (datesOverlap(assignmentStart, assignmentEnd, nextWeekStart, nextWeekEnd)) {
                  colSpan++
                } else {
                  break
                }
              }

              assignmentCells.push({
                groupId: group.group_id,
                weekStart,
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
      map.set(weekStart.getTime(), index)
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

    lessonAssignments.forEach((lessonAssignment) => {
      if (!map.has(lessonAssignment.group_id)) {
        map.set(lessonAssignment.group_id, new Map())
      }

      map.get(lessonAssignment.group_id)!.set(lessonAssignment.lesson_id, lessonAssignment)
    })

    return map
  }, [lessonAssignments])

  const formatWeekStart = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const formatShortDate = (dateString: string) => {
    const parsed = new Date(dateString)
    if (Number.isNaN(parsed.getTime())) {
      return dateString
    }

    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
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

    const assignmentStart = new Date(assignment.start_date)
    const assignmentEnd = new Date(assignment.end_date)

    const scheduledLessons = unitLessons
      .map((lesson) => {
        const lessonAssignment = groupLessonAssignments.get(lesson.lesson_id)
        if (!lessonAssignment) {
          return null
        }

        const lessonDate = new Date(lessonAssignment.start_date)
        if (Number.isNaN(lessonDate.getTime())) {
          return null
        }

        if (lessonDate < assignmentStart || lessonDate > assignmentEnd) {
          return null
        }

        return { lesson, assignment: lessonAssignment, date: lessonDate }
      })
      .filter(
        (entry): entry is { lesson: Lesson; assignment: LessonAssignment; date: Date } => entry !== null,
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    if (scheduledLessons.length === 0) {
      return []
    }

    const startIndex = weekStartIndexLookup.get(cell.weekStart.getTime())

    if (startIndex === undefined) {
      return []
    }

    const lessonsByWeek: {
      weekIndex: number
      lessons: { lesson: Lesson; assignment: LessonAssignment; date: Date }[]
    }[] = []

    for (let offset = 0; offset < cell.colSpan; offset++) {
      const weekIndex = startIndex + offset
      const weekStart = weekStarts[weekIndex]

      if (!weekStart) {
        continue
      }

      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)

      const lessonsForWeek = scheduledLessons.filter(({ date }) => date >= weekStart && date <= weekEnd)
      lessonsByWeek.push({ weekIndex, lessons: lessonsForWeek })
    }

    return lessonsByWeek
  }

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-primary">Assignment Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
                    className="sticky left-0 bg-muted p-3 text-left font-semibold border border-border"
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
                  {weekStarts.map((weekStart, index) => (
                    <th
                      key={index}
                      className="p-3 text-center font-semibold border border-border bg-muted"
                      style={{ width: WEEK_COLUMN_WIDTH }}
                    >
                      <div className="text-sm">{formatWeekStart(weekStart)}</div>
                    </th>
                  ))}
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
                                          const summary = feedbackSummaryMap.get(summaryKey)
                                          const totalPupils = summary?.total_pupils ?? 0
                                          const hasPupils = totalPupils > 0
                                          const positiveCount = summary?.positive_count ?? 0
                                          const negativeCount = summary?.negative_count ?? 0
                                          const rawPositive = hasPupils
                                            ? Math.round((positiveCount / totalPupils) * 100)
                                            : 0
                                          const rawNegative = hasPupils
                                            ? Math.round((negativeCount / totalPupils) * 100)
                                            : 0
                                          const normalizedPositive = Math.min(100, Math.max(0, rawPositive))
                                          const normalizedNegative = Math.min(
                                            100 - normalizedPositive,
                                            Math.max(0, rawNegative),
                                          )
                                          const normalizedUnmarked = hasPupils
                                            ? Math.max(0, 100 - normalizedPositive - normalizedNegative)
                                            : 100
                                          const gradient = hasPupils
                                            ? `linear-gradient(to right, ${POSITIVE_SEGMENT_COLOR} 0%, ${POSITIVE_SEGMENT_COLOR} ${normalizedPositive}%, ${NEGATIVE_SEGMENT_COLOR} ${normalizedPositive}%, ${NEGATIVE_SEGMENT_COLOR} ${normalizedPositive + normalizedNegative}%, ${UNMARKED_SEGMENT_COLOR} ${normalizedPositive + normalizedNegative}%, ${UNMARKED_SEGMENT_COLOR} 100%)`
                                            : `linear-gradient(to right, ${UNMARKED_SEGMENT_COLOR}, ${UNMARKED_SEGMENT_COLOR})`
                                          const showSummaryBreakdown =
                                            hasPupils && (normalizedPositive > 0 || normalizedNegative > 0)

                                          const resultsAssignmentId = `${cell.assignment!.group_id}__${lesson.lesson_id}`
                                          return (
                                            <Link
                                              key={lesson.lesson_id}
                                              href={`/results/assignments/${encodeURIComponent(resultsAssignmentId)}`}
                                              className="block rounded-md border border-border/70 px-2 py-2 text-xs font-medium shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                              title={`View assignment results for ${lesson.title} • ${formatShortDate(lessonAssignment.start_date)}`}
                                              style={{
                                                backgroundImage: gradient,
                                                backgroundColor: UNMARKED_SEGMENT_COLOR,
                                              }}
                                            >
                                              <div className="flex flex-col gap-2">
                                                <span
                                                  className="truncate text-xs font-semibold"
                                                  style={{ color: LESSON_TITLE_COLOR }}
                                                >
                                                  {lesson.title}
                                                </span>
                                                {hasPupils ? (
                                                  showSummaryBreakdown ? (
                                                    <div
                                                      className="flex items-center justify-between text-[10px] font-medium"
                                                      style={{ color: LESSON_DETAIL_COLOR }}
                                                    >
                                                      <span>Pos {normalizedPositive}%</span>
                                                      <span>Neg {normalizedNegative}%</span>
                                                      <span>None {normalizedUnmarked}%</span>
                                                    </div>
                                                  ) : (
                                                    <span
                                                      className="text-[10px] font-medium"
                                                      style={{ color: LESSON_DETAIL_COLOR }}
                                                    >
                                                      No feedback yet
                                                    </span>
                                                  )
                                                ) : (
                                                  <span
                                                    className="text-[10px] font-medium"
                                                    style={{ color: LESSON_DETAIL_COLOR }}
                                                  >
                                                    No pupils yet
                                                  </span>
                                                )}
                                              </div>
                                            </Link>
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
