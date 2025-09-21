"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { X } from "lucide-react"
import type { Unit, Assignment, Lesson, LessonAssignment } from "@/types"
import { truncateText } from "@/lib/utils"

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

  const matchingUnits = useMemo(() => {
    if (!groupSubject) return units
    return units.filter((unit) => unit.subject === groupSubject)
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

    const start = new Date(editedAssignment.start_date)
    const end = new Date(editedAssignment.end_date)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return []
    }

    const options: { value: string; label: string }[] = []
    const cursor = new Date(start)

    // advance to the first Sunday on/after the start date
    const daysUntilSunday = (7 - cursor.getDay()) % 7
    cursor.setDate(cursor.getDate() + daysUntilSunday)

    while (cursor.getTime() <= end.getTime()) {
      const iso = cursor.toISOString().split("T")[0]
      options.push({
        value: iso,
        label: cursor.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })
      cursor.setDate(cursor.getDate() + 7)
    }

    return options
  }, [editedAssignment])

  const lessonAssignmentsByLessonId = useMemo(() => {
    if (!editedAssignment) return new Map<string, LessonAssignment>()

    const relevantAssignments = lessonAssignments.filter(
      (entry) => entry.group_id === editedAssignment.group_id,
    )

    return new Map<string, LessonAssignment>(
      relevantAssignments.map((entry) => [entry.lesson_id, entry] as const),
    )
  }, [lessonAssignments, editedAssignment])

  useEffect(() => {
    if (assignment) {
      // Edit mode
      setEditedAssignment({ ...assignment })
    } else if (newAssignmentData) {
      // Create mode
      const endDate = new Date(newAssignmentData.startDate)
      endDate.setDate(endDate.getDate() + 6) // Default to 1 week duration

      setEditedAssignment({
        group_id: newAssignmentData.groupId,
        unit_id: matchingUnits.length > 0 ? matchingUnits[0].unit_id : "",
        start_date: newAssignmentData.startDate,
        end_date: endDate.toISOString().split("T")[0],
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
                    disabled={matchingUnits.length === 0}
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
                      <Input
                        id="start-date"
                        type="date"
                        value={editedAssignment.start_date}
                        onChange={(e) =>
                          setEditedAssignment((prev) => (prev ? { ...prev, start_date: e.target.value } : null))
                        }
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">End Date</span>
                      <Input
                        id="end-date"
                        type="date"
                        value={editedAssignment.end_date}
                        onChange={(e) =>
                          setEditedAssignment((prev) => (prev ? { ...prev, end_date: e.target.value } : null))
                        }
                      />
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
                    {unitLessons.map((lesson) => {
                      const assignedDate = lessonAssignmentsByLessonId.get(lesson.lesson_id)?.start_date ?? ""
                      const assignmentKey = `${editedAssignment.group_id}__${lesson.lesson_id}`
                      const isPending = Boolean(pendingLessonAssignmentKeys?.[assignmentKey])
                      const validAssignedDate = assignmentDateOptions.some((option) => option.value === assignedDate)

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
                              value={validAssignedDate ? assignedDate : undefined}
                              onValueChange={(value) => {
                                if (value === assignedDate) {
                                  return
                                }
                                onLessonDateChange?.(lesson.lesson_id, value)
                              }}
                              disabled={!onLessonDateChange || isPending || assignmentDateOptions.length === 0}
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder={assignmentDateOptions.length ? "Select a date" : "No dates"} />
                              </SelectTrigger>
                              <SelectContent>
                                {assignmentDateOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!onLessonDateChange || !assignedDate || isPending}
                              onClick={() => onLessonDateChange?.(lesson.lesson_id, null)}
                            >
                              Clear
                            </Button>
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
