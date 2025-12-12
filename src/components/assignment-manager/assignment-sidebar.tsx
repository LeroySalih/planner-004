"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MoreVertical, X } from "lucide-react"
import type { Unit, Assignment, Lesson, LessonAssignment } from "@/types"
import { normalizeAssignmentWeek, normalizeDateOnly, truncateText } from "@/lib/utils"

function buildWeekdayOptions(weekday: number, count = 52) {
  const options: { value: string; label: string }[] = []
  const cursor = new Date()
  cursor.setUTCHours(0, 0, 0, 0)

  while (cursor.getUTCDay() !== weekday) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  for (let index = 0; index < count; index += 1) {
    const iso = normalizeDateOnly(cursor)
    if (iso) {
      options.push({ value: iso, label: iso })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }

  return options
}

interface AssignmentSidebarProps {
  isOpen: boolean
  onClose: () => void
  assignment: Assignment | null
  units: Unit[]
  groupSubject?: string
  onSave: (updatedAssignment: Assignment) => void
  onDelete: () => void
  onCreate?: (newAssignment: Assignment) => void
  newAssignmentData?: { groupId: string; startDate: string }
  selectedGroups?: string[]
  onOpenGroupSelection?: () => void
  lessons?: Lesson[]
  lessonAssignments?: LessonAssignment[]
  onLessonDateChange?: (lessonId: string, startDate: string | null) => void
  pendingLessonAssignmentKeys?: Record<string, boolean>
}

export function AssignmentSidebar({
  isOpen,
  onClose,
  assignment,
  units,
  groupSubject,
  onSave,
  onDelete,
  onCreate,
  newAssignmentData,
  selectedGroups,
  onOpenGroupSelection,
  lessons = [],
  lessonAssignments = [],
  onLessonDateChange,
  pendingLessonAssignmentKeys,
}: AssignmentSidebarProps) {
  const [editedAssignment, setEditedAssignment] = useState<Assignment | null>(null)
  const [lessonDateDrafts, setLessonDateDrafts] = useState<Record<string, string>>({})
  const lastDraftGroupIdRef = useRef<string | null>(null)

  const matchingUnits = useMemo(() => {
    if (!groupSubject) return units
    const filtered = units.filter((unit) => unit.subject === groupSubject)
    // Fallback to all units so the selector is never disabled even if subjects don't line up.
    return filtered.length > 0 ? filtered : units
  }, [units, groupSubject])

  const selectedUnit = useMemo(() => {
    if (!editedAssignment) return undefined
    return units.find((unit) => unit.unit_id === editedAssignment.unit_id)
  }, [editedAssignment, units])

  const unitLessons = useMemo(() => {
    if (!editedAssignment) return []
    return lessons
      .filter((lesson) => lesson.unit_id === editedAssignment.unit_id)
      .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
  }, [lessons, editedAssignment])

  const assignmentDateOptions = useMemo(() => {
    if (!editedAssignment) return []

    const snapped = normalizeAssignmentWeek(editedAssignment.start_date, editedAssignment.end_date)
    const startValue = snapped?.start ?? normalizeDateOnly(editedAssignment.start_date)
    const endValue = snapped?.end ?? normalizeDateOnly(editedAssignment.end_date)

    if (!startValue || !endValue) {
      return []
    }

    const start = new Date(`${startValue}T00:00:00Z`)
    const end = new Date(`${endValue}T00:00:00Z`)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return []
    }

    const options: { value: string; label: string }[] = []
    const cursor = new Date(start)

    // advance to the first Sunday on/after the start date
    const daysUntilSunday = (7 - cursor.getUTCDay()) % 7
    cursor.setUTCDate(cursor.getUTCDate() + daysUntilSunday)

    while (cursor.getTime() <= end.getTime()) {
      const iso = normalizeDateOnly(cursor)
      if (iso) {
        options.push({
          value: iso,
          label: iso,
        })
      }
      cursor.setUTCDate(cursor.getUTCDate() + 7)
    }

    return options
  }, [editedAssignment])

  const lessonAssignmentsByLessonId = useMemo(() => {
    if (!editedAssignment) return new Map<string, LessonAssignment>()

    const relevantAssignments = lessonAssignments
      .filter((entry) => entry.group_id === editedAssignment.group_id)
      .map((entry) => ({
        ...entry,
        start_date: normalizeDateOnly(entry.start_date) ?? entry.start_date,
      }))

    return new Map<string, LessonAssignment>(
      relevantAssignments.map((entry) => [entry.lesson_id, entry] as const),
    )
  }, [lessonAssignments, editedAssignment])

  const activeGroupId = editedAssignment?.group_id ?? null

  const planLessonDatesForwardFromIndex = useCallback(
    (startIndex: number) => {
      if (!onLessonDateChange || assignmentDateOptions.length === 0 || !activeGroupId) {
        return
      }

      const startingLesson = unitLessons[startIndex]
      if (!startingLesson) {
        return
      }

      const startingLessonDate =
        lessonDateDrafts[startingLesson.lesson_id] ??
        lessonAssignmentsByLessonId.get(startingLesson.lesson_id)?.start_date
      if (!startingLessonDate) {
        return
      }

      const startingOptionIndex = assignmentDateOptions.findIndex(
        (option) => option.value === startingLessonDate,
      )

      if (startingOptionIndex === -1) {
        return
      }

      let nextOptionIndex = startingOptionIndex

      for (let lessonIndex = startIndex + 1; lessonIndex < unitLessons.length; lessonIndex += 1) {
        nextOptionIndex += 1
        const nextOption = assignmentDateOptions[nextOptionIndex]
        if (!nextOption) {
          break
        }

        const nextLesson = unitLessons[lessonIndex]
        const assignmentKey = `${activeGroupId}__${nextLesson.lesson_id}`
        const isPending = Boolean(pendingLessonAssignmentKeys?.[assignmentKey])

        if (isPending) {
          continue
        }

        onLessonDateChange(nextLesson.lesson_id, nextOption.value)
      }
    },
    [
      assignmentDateOptions,
      activeGroupId,
      lessonAssignmentsByLessonId,
      onLessonDateChange,
      pendingLessonAssignmentKeys,
      unitLessons,
      lessonDateDrafts,
    ],
  )

  const planLessonDatesBackwardFromIndex = useCallback(
    (startIndex: number) => {
      if (!onLessonDateChange || assignmentDateOptions.length === 0 || !activeGroupId) {
        return
      }

      const startingLesson = unitLessons[startIndex]
      if (!startingLesson) {
        return
      }

      const startingLessonDate =
        lessonDateDrafts[startingLesson.lesson_id] ??
        lessonAssignmentsByLessonId.get(startingLesson.lesson_id)?.start_date
      if (!startingLessonDate) {
        return
      }

      const startingOptionIndex = assignmentDateOptions.findIndex(
        (option) => option.value === startingLessonDate,
      )

      if (startingOptionIndex === -1) {
        return
      }

      let previousOptionIndex = startingOptionIndex

      for (let lessonIndex = startIndex - 1; lessonIndex >= 0; lessonIndex -= 1) {
        previousOptionIndex -= 1
        const previousOption = assignmentDateOptions[previousOptionIndex]
        if (!previousOption) {
          break
        }

        const previousLesson = unitLessons[lessonIndex]
        const assignmentKey = `${activeGroupId}__${previousLesson.lesson_id}`
        const isPending = Boolean(pendingLessonAssignmentKeys?.[assignmentKey])

        if (isPending) {
          continue
        }

        onLessonDateChange(previousLesson.lesson_id, previousOption.value)
      }
    },
    [
      assignmentDateOptions,
      activeGroupId,
      lessonAssignmentsByLessonId,
      lessonDateDrafts,
      onLessonDateChange,
      pendingLessonAssignmentKeys,
      unitLessons,
    ],
  )

  useEffect(() => {
    if (!editedAssignment) {
      setLessonDateDrafts({})
      lastDraftGroupIdRef.current = null
      return
    }

    const groupId = editedAssignment.group_id
    const currentGroupDates = lessonAssignments.reduce<Record<string, string>>((acc, entry) => {
      if (entry.group_id !== groupId) {
        return acc
      }

      const normalized = normalizeDateOnly(entry.start_date)
      if (normalized) {
        acc[entry.lesson_id] = normalized
      }

      return acc
    }, {})

    setLessonDateDrafts((prev) => {
      const next = { ...prev }

      Object.keys(next).forEach((lessonId) => {
        if (!(lessonId in currentGroupDates)) {
          delete next[lessonId]
        }
      })

      Object.entries(currentGroupDates).forEach(([lessonId, date]) => {
        next[lessonId] = date
      })

      lastDraftGroupIdRef.current = groupId

      return next
    })
  }, [editedAssignment, lessonAssignments])

  useEffect(() => {
    if (assignment) {
      // Edit mode
      setEditedAssignment({
        ...assignment,
        start_date: normalizeDateOnly(assignment.start_date) ?? assignment.start_date,
        end_date: normalizeDateOnly(assignment.end_date) ?? assignment.end_date,
      })
    } else if (newAssignmentData) {
      // Create mode
      const normalizedStart = normalizeDateOnly(newAssignmentData.startDate) ?? newAssignmentData.startDate
      const endDate = new Date(`${normalizedStart}T00:00:00Z`)
      endDate.setUTCDate(endDate.getUTCDate() + 6) // Default to 1 week duration
      const snapped = normalizeAssignmentWeek(normalizedStart, endDate)

      setEditedAssignment({
        group_id: newAssignmentData.groupId,
        unit_id: matchingUnits.length > 0 ? matchingUnits[0].unit_id : "",
        start_date: snapped?.start ?? normalizedStart,
        end_date: snapped?.end ?? normalizeDateOnly(endDate) ?? endDate.toISOString().slice(0, 10),
        active: true,
      })
    }
  }, [assignment, newAssignmentData, matchingUnits])

  const handleSave = () => {
    if (editedAssignment) {
      if (assignment) {
        // Edit mode
        onSave(editedAssignment)
      } else if (onCreate) {
        // Create mode
        onCreate(editedAssignment)
      }
      onClose()
    }
  }

  const handleDelete = () => {
    onDelete()
    onClose()
  }

  const sundayOptions = useMemo(() => {
    const filtered = assignmentDateOptions.filter((option) => {
      const date = new Date(`${option.value}T00:00:00Z`)
      return date.getUTCDay() === 0
    })
    if (filtered.length > 0) return filtered
    return buildWeekdayOptions(0)
  }, [assignmentDateOptions])

  const saturdayOptions = useMemo(() => {
    const filtered = assignmentDateOptions.filter((option) => {
      const date = new Date(`${option.value}T00:00:00Z`)
      return date.getUTCDay() === 6
    })
    if (filtered.length > 0) return filtered
    return buildWeekdayOptions(6)
  }, [assignmentDateOptions])

  const handleDateSelect = (field: "start_date" | "end_date", value: string) => {
    const normalized = normalizeDateOnly(value) ?? ""
    setEditedAssignment((prev) => (prev ? { ...prev, [field]: normalized } : prev))
  }

  if (!isOpen || !editedAssignment) {
    return null
  }

  const isCreateMode = !assignment && newAssignmentData
  const unitDescriptionSnippet = selectedUnit?.description
    ? truncateText(selectedUnit.description, 250)
    : undefined

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Sidebar */}
      <div className="relative ml-auto w-96 bg-background shadow-xl border-l">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">
              {isCreateMode ? "Create New Assignment" : "Edit Assignment"}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-6">
            <Tabs defaultValue="details" className="space-y-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="lessonDates">Lesson Dates</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-6">
                {/* Group ID (read-only) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="group-id">Group ID</Label>
                    {isCreateMode && (
                      <Button variant="outline" size="sm" onClick={onOpenGroupSelection}>
                        Select groups
                      </Button>
                    )}
                  </div>
                  <Input id="group-id" value={editedAssignment.group_id} disabled className="bg-muted" />
                  {groupSubject && (
                    <div className="text-xs text-muted-foreground">Subject: {groupSubject}</div>
                  )}
                  {isCreateMode && selectedGroups && selectedGroups.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Assigning to {selectedGroups.length} group{selectedGroups.length > 1 ? "s" : ""}
                    </div>
                  )}
                </div>

                {/* Unit Selection */}
                <div className="space-y-2">
                  <Label htmlFor="unit-select">Unit</Label>
                  <Select
                    value={editedAssignment.unit_id}
                    onValueChange={(value) => setEditedAssignment((prev) => (prev ? { ...prev, unit_id: value } : null))}
                    disabled={units.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {matchingUnits.map((unit) => (
                        <SelectItem key={unit.unit_id} value={unit.unit_id}>
                          {unit.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {unitDescriptionSnippet && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Unit Description</Label>
                    <p className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                      {unitDescriptionSnippet}
                    </p>
                  </div>
                )}

                {/* Schedule */}
                <div className="space-y-3">
                  <Label>Schedule</Label>
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">Start Date</span>
                      <Select
                        value={normalizeDateOnly(editedAssignment.start_date) ?? ""}
                        onValueChange={(value) => handleDateSelect("start_date", value)}
                        disabled={sundayOptions.length === 0}
                      >
                        <SelectTrigger id="start-date">
                          <SelectValue placeholder="Select a Sunday" />
                        </SelectTrigger>
                        <SelectContent>
                          {sundayOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-1">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">End Date</span>
                      <Select
                        value={normalizeDateOnly(editedAssignment.end_date) ?? ""}
                        onValueChange={(value) => handleDateSelect("end_date", value)}
                        disabled={saturdayOptions.length === 0}
                      >
                        <SelectTrigger id="end-date">
                          <SelectValue placeholder="Select a Saturday" />
                        </SelectTrigger>
                        <SelectContent>
                          {saturdayOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    Duration: {calculateWeeks(editedAssignment.start_date, editedAssignment.end_date)} weeks
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-3 pt-2">
                  <Button onClick={handleSave} className="w-full">
                    {isCreateMode ? "Create Assignment" : "Save Changes"}
                  </Button>
                  {!isCreateMode && (
                    <Button onClick={handleDelete} variant="destructive" className="w-full">
                      Delete Assignment
                    </Button>
                  )}
                  <Button onClick={onClose} variant="outline" className="w-full bg-transparent">
                    Cancel
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="lessonDates" className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Lesson Dates</Label>
                  <span className="text-xs text-muted-foreground">
                    Assign a specific date to each lesson in this unit.
                  </span>
                </div>

                {unitLessons.length > 0 ? (
                  <div className="max-h-96 overflow-y-auto pr-1">
                    {assignmentDateOptions.length === 0 && (
                      <div className="mb-3 rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                        Update the assignment start and end dates to enable lesson scheduling.
                      </div>
                    )}
                    {unitLessons.map((lesson, lessonIndex) => {
                      const assignedDateRaw = lessonAssignmentsByLessonId.get(lesson.lesson_id)?.start_date ?? ""
                      const assignedDate = normalizeDateOnly(assignedDateRaw) ?? ""
                      const selectedLessonDate = lessonDateDrafts[lesson.lesson_id] ?? assignedDate
                      const assignedDateIndex = assignmentDateOptions.findIndex(
                        (option) => option.value === selectedLessonDate,
                      )
                      const selectOptions =
                        assignedDateIndex === -1 && selectedLessonDate
                          ? [{ value: selectedLessonDate, label: selectedLessonDate }, ...assignmentDateOptions]
                          : assignmentDateOptions
                      const assignmentKey = `${editedAssignment.group_id}__${lesson.lesson_id}`
                      const isPending = Boolean(pendingLessonAssignmentKeys?.[assignmentKey])
                      const validAssignedDate = assignedDateIndex !== -1
                      const canPlanFromHere =
                        Boolean(onLessonDateChange) &&
                        assignmentDateOptions.length > 0 &&
                        validAssignedDate &&
                        !isPending
                      const canPlanBackward = canPlanFromHere && lessonIndex > 0 && assignedDateIndex > 0
                      const canClear = Boolean(onLessonDateChange) && Boolean(selectedLessonDate) && !isPending

                      return (
                        <div
                          key={lesson.lesson_id}
                          className="space-y-2 rounded-md border border-border/60 bg-muted/40 p-3 mb-2 last:mb-0"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-sm font-medium leading-tight" title={lesson.title}>
                              {lesson.title}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Lesson #{(lesson.order_by ?? 0) + 1}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              value={selectedLessonDate || undefined}
                              onValueChange={(value) => {
                                const normalizedValue = normalizeDateOnly(value)
                                if (!normalizedValue || normalizedValue === selectedLessonDate) {
                                  return
                                }
                                setLessonDateDrafts((prev) => ({
                                  ...prev,
                                  [lesson.lesson_id]: normalizedValue,
                                }))
                                onLessonDateChange?.(lesson.lesson_id, normalizedValue)
                              }}
                              disabled={!onLessonDateChange || isPending || assignmentDateOptions.length === 0}
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder={assignmentDateOptions.length ? "Select a date" : "No dates"} />
                              </SelectTrigger>
                              <SelectContent>
                                {selectOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8" aria-label="Lesson actions">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  disabled={!canClear}
                                  onSelect={(event) => {
                                    event.preventDefault()
                                    if (!canClear) {
                                      return
                                    }
                                    setLessonDateDrafts((prev) => {
                                      const next = { ...prev }
                                      delete next[lesson.lesson_id]
                                      return next
                                    })
                                    onLessonDateChange?.(lesson.lesson_id, null)
                                  }}
                                >
                                  Clear date
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canPlanFromHere}
                                  onSelect={(event) => {
                                    event.preventDefault()
                                    if (!canPlanFromHere) {
                                      return
                                    }
                                    planLessonDatesForwardFromIndex(lessonIndex)
                                  }}
                                >
                                  Reschedule forward
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canPlanBackward}
                                  onSelect={(event) => {
                                    event.preventDefault()
                                    if (!canPlanBackward) {
                                      return
                                    }
                                    planLessonDatesBackwardFromIndex(lessonIndex)
                                  }}
                                >
                                  Reschedule back
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                    {matchingUnits.length === 0
                      ? "Select a unit to access its lessons."
                      : "This unit does not have any lessons yet."}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function calculateWeeks(startDate: string, endDate: string) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffMs = end.getTime() - start.getTime()
  if (Number.isNaN(diffMs) || diffMs < 0) {
    return 0
  }
  const weeks = diffMs / (1000 * 60 * 60 * 24 * 7)
  return Math.max(1, Math.ceil(weeks))
}
