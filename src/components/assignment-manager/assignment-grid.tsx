"use client"

import type React from "react"
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Group, Unit, Assignment, Lesson, LessonAssignment } from "@/types"


interface AssignmentGridProps {
  groups: Group[]
  units: Unit[]
  assignments: Assignment[]
  lessons: Lesson[]
  lessonAssignments: LessonAssignment[]
  onAssignmentClick?: (assignment: Assignment) => void
  onEmptyCellClick?: (groupId: string, weekStart: Date) => void
  onUnitTitleClick?: (assignment: Assignment) => void
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

interface UnitTooltipProps {
  assignment: Assignment & { unit: Unit }
  onTitleClick: () => void
  position: { x: number; y: number }
}

function UnitTooltip({ assignment, onTitleClick, position }: UnitTooltipProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  return (
    <div
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 max-w-xs pointer-events-auto"
      style={{
        left: `${position.x}px`,
        top: `${position.y - 5}px`,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="space-y-2">
        <button
          onClick={onTitleClick}
          className="font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer text-left w-full"
        >
          {assignment.unit.title}
        </button>
        <div className="text-sm text-muted-foreground">
          <div>
            <strong>Subject:</strong> {assignment.unit.subject}
          </div>
          <div>
            <strong>Start:</strong> {formatDate(assignment.start_date)}
          </div>
          <div>
            <strong>End:</strong> {formatDate(assignment.end_date)}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AssignmentGrid({
  groups,
  units,
  assignments,
  lessons,
  lessonAssignments,
  onAssignmentClick,
  onEmptyCellClick,
  onUnitTitleClick,
  onAddGroupClick, // Updated prop name
  onGroupTitleClick, // Added onGroupTitleClick prop
}: AssignmentGridProps) {
  const router = useRouter()
  const [hoveredAssignment, setHoveredAssignment] = useState<(Assignment & { unit: Unit }) | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isTooltipHovered, setIsTooltipHovered] = useState(false)

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

  const handleMouseEnter = (assignment: Assignment & { unit: Unit }, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setHoveredAssignment(assignment)
    setMousePosition({
      x: rect.left + rect.width / 2,
      y: rect.top,
    })
  }

  const handleMouseLeave = () => {
    setTimeout(() => {
      if (!isTooltipHovered) {
        setHoveredAssignment(null)
      }
    }, 100)
  }

  const handleUnitTitleClick = (assignment: Assignment & { unit: Unit }) => {
    setHoveredAssignment(null)
    router.push(`/units/${assignment.unit.unit_id ?? assignment.unit_id}`)
    onUnitTitleClick?.({
      group_id: assignment.group_id,
      unit_id: assignment.unit_id,
      start_date: assignment.start_date,
      end_date: assignment.end_date,
    })
  }

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-primary">Assignment Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-muted p-3 text-left font-semibold border border-border min-w-32">
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
                    <th key={index} className="p-3 text-center font-semibold border border-border min-w-32 bg-muted">
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
                                ? "bg-primary/10 hover:bg-primary/20 transition-colors cursor-pointer"
                                : "bg-background hover:bg-muted/50 transition-colors cursor-pointer"
                            }`}
                            onClick={() => {
                              if (cell.assignment && onAssignmentClick) {
                                onAssignmentClick({
                                  group_id: cell.assignment.group_id,
                                  unit_id: cell.assignment.unit_id,
                                  start_date: cell.assignment.start_date,
                                  end_date: cell.assignment.end_date,
                                })
                              } else if (!cell.assignment && onEmptyCellClick) {
                                onEmptyCellClick(cell.groupId, cell.weekStart)
                              }
                            }}
                            onMouseLeave={cell.assignment ? handleMouseLeave : undefined}
                          >
                            {cell.assignment && (
                              <div className="flex h-full flex-col">
                                <div className="flex flex-1 items-center justify-center text-center">
                                  <div className="w-full">
                                    <div
                                      className="font-medium text-sm text-primary truncate cursor-pointer hover:text-primary/80 transition-colors"
                                      onMouseEnter={(e) => handleMouseEnter(cell.assignment!, e)}
                                    >
                                      {cell.assignment.unit.title}
                                    </div>
                                  </div>
                                </div>
                                {hasScheduledLessons && (
                                  <div
                                    className="mt-2 grid gap-2"
                                    style={{ gridTemplateColumns: `repeat(${cell.colSpan}, minmax(0, 1fr))` }}
                                  >
                                    {lessonsByWeek.map(({ lessons: weekLessons, weekIndex }) => (
                                      <div key={weekIndex} className="flex flex-col gap-1">
                                        {weekLessons.map(({ lesson, assignment: lessonAssignment }) => (
                                          <Link
                                            key={lesson.lesson_id}
                                            href={`/feedback/groups/${encodeURIComponent(cell.assignment!.group_id)}/lessons/${encodeURIComponent(lesson.lesson_id)}`}
                                            className="truncate rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/80"
                                            title={`${lesson.title} • ${formatShortDate(lessonAssignment.start_date)}`}
                                          >
                                            <span>{lesson.title}</span>
                                          </Link>
                                        ))}
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

      {hoveredAssignment && (
        <div
          onMouseEnter={() => setIsTooltipHovered(true)}
          onMouseLeave={() => {
            setIsTooltipHovered(false)
            setHoveredAssignment(null)
          }}
        >
          <UnitTooltip
            assignment={hoveredAssignment}
            onTitleClick={() => handleUnitTitleClick(hoveredAssignment)}
            position={mousePosition}
          />
        </div>
      )}
    </>
  )
}
