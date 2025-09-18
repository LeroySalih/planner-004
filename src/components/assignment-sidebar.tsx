"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X } from "lucide-react"
import type { Unit, Assignment } from "@/types/assignment"

interface AssignmentSidebarProps {
  isOpen: boolean
  onClose: () => void
  assignment: Assignment | null
  units: Unit[]
  onSave: (updatedAssignment: Assignment) => void
  onDelete: () => void
  onCreate?: (newAssignment: Assignment) => void
  newAssignmentData?: { groupId: string; startDate: string }
}

export function AssignmentSidebar({
  isOpen,
  onClose,
  assignment,
  units,
  onSave,
  onDelete,
  onCreate,
  newAssignmentData,
}: AssignmentSidebarProps) {
  const [editedAssignment, setEditedAssignment] = useState<Assignment | null>(null)

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
        unit_id: units.length > 0 ? units[0].unit_id : "",
        start_date: newAssignmentData.startDate,
        end_date: endDate.toISOString().split("T")[0],
      })
    }
  }, [assignment, newAssignmentData, units])

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

  const currentUnit = units.find((u) => u.unit_id === editedAssignment.unit_id)
  const isCreateMode = !assignment && newAssignmentData

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
            {/* Group ID (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="group-id">Group ID</Label>
              <Input id="group-id" value={editedAssignment.group_id} disabled className="bg-muted" />
            </div>

            {/* Unit Selection */}
            <div className="space-y-2">
              <Label htmlFor="unit-select">Unit</Label>
              <Select
                value={editedAssignment.unit_id}
                onValueChange={(value) => setEditedAssignment((prev) => (prev ? { ...prev, unit_id: value } : null))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a unit" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((unit) => (
                    <SelectItem key={unit.unit_id} value={unit.unit_id}>
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{unit.title}</span>
                        <span className="text-xs text-muted-foreground">{unit.subject}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Current Unit Info */}
            {currentUnit && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm font-medium">{currentUnit.title}</div>
                <div className="text-xs text-muted-foreground">{currentUnit.subject}</div>
              </div>
            )}

            {/* Start Date */}
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={editedAssignment.start_date}
                onChange={(e) => setEditedAssignment((prev) => (prev ? { ...prev, start_date: e.target.value } : null))}
              />
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={editedAssignment.end_date}
                onChange={(e) => setEditedAssignment((prev) => (prev ? { ...prev, end_date: e.target.value } : null))}
              />
            </div>

            {/* Duration Info */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="text-sm text-muted-foreground">
                Duration:{" "}
                {Math.ceil(
                  (new Date(editedAssignment.end_date).getTime() - new Date(editedAssignment.start_date).getTime()) /
                    (1000 * 60 * 60 * 24),
                )}{" "}
                days
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-4">
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
