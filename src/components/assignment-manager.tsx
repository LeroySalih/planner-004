"use client"

import { useState } from "react"
import { AssignmentGrid } from "./assignment-grid"
import { AssignmentSidebar } from "./assignment-sidebar"
import { GroupSidebar } from "./group-sidebar" // Import new GroupSidebar
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Assignment, EducationalData, AssignmentManagerProps, Group } from "./types/assignment"
import { initialData } from "./data/sample-data"

export function AssignmentManager({ onChange }: AssignmentManagerProps) {
  const [data, setData] = useState<EducationalData>(initialData)
  const [isEditing, setIsEditing] = useState(false)
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isGroupSidebarOpen, setIsGroupSidebarOpen] = useState(false) // Add group sidebar state
  const [newAssignmentData, setNewAssignmentData] = useState<{ groupId: string; startDate: string } | null>(null)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null) // Added state for editing groups

  const addAssignment = (newAssignment: Assignment) => {
    setData((prev) => ({
      ...prev,
      assignments: [...prev.assignments, newAssignment],
    }))
    onChange?.(newAssignment, "create")
  }

  const updateAssignment = (index: number, updatedAssignment: Assignment) => {
    const oldAssignment = data.assignments[index]
    setData((prev) => ({
      ...prev,
      assignments: prev.assignments.map((assignment, i) => (i === index ? updatedAssignment : assignment)),
    }))
    onChange?.(updatedAssignment, "edit")
  }

  const deleteAssignment = (index: number) => {
    const assignmentToDelete = data.assignments[index]
    setData((prev) => ({
      ...prev,
      assignments: prev.assignments.filter((_, i) => i !== index),
    }))
    onChange?.(assignmentToDelete, "delete")
  }

  const resetData = () => {
    setData(initialData)
  }

  const handleAssignmentClick = (assignment: Assignment) => {
    setSelectedAssignment(assignment)
    setNewAssignmentData(null)
    setIsSidebarOpen(true)
  }

  const handleEmptyCellClick = (groupId: string, weekStart: Date) => {
    setSelectedAssignment(null)
    setNewAssignmentData({
      groupId,
      startDate: weekStart.toISOString().split("T")[0],
    })
    setIsSidebarOpen(true)
  }

  const handleUnitTitleClick = (assignment: Assignment) => {
    console.log("[v0] Unit title clicked from hover tooltip:", assignment)
    onChange?.(assignment, "unit-title-click")
  }

  const handleSidebarSave = (updatedAssignment: Assignment) => {
    const index = data.assignments.findIndex(
      (a) =>
        a.group_id === selectedAssignment?.group_id &&
        a.unit_id === selectedAssignment?.unit_id &&
        a.start_date === selectedAssignment?.start_date &&
        a.end_date === selectedAssignment?.end_date,
    )
    if (index !== -1) {
      updateAssignment(index, updatedAssignment)
    }
  }

  const handleSidebarDelete = () => {
    const index = data.assignments.findIndex(
      (a) =>
        a.group_id === selectedAssignment?.group_id &&
        a.unit_id === selectedAssignment?.unit_id &&
        a.start_date === selectedAssignment?.start_date &&
        a.end_date === selectedAssignment?.end_date,
    )
    if (index !== -1) {
      deleteAssignment(index)
    }
  }

  const handleSidebarCreate = (newAssignment: Assignment) => {
    addAssignment(newAssignment)
  }

  const closeSidebar = () => {
    setIsSidebarOpen(false)
    setSelectedAssignment(null)
    setNewAssignmentData(null)
  }

  const addGroup = (groupName: string, subjectId: string) => {
    const newGroup = {
      group_id: groupName,
      subject_id: subjectId,
    }
    setData((prev) => ({
      ...prev,
      groups: [...prev.groups, newGroup],
    }))
    console.log("[v0] Added new group:", newGroup)
  }

  const updateGroup = (oldGroupId: string, newGroupId: string, subjectId: string) => {
    setData((prev) => ({
      ...prev,
      groups: prev.groups.map((group) =>
        group.group_id === oldGroupId ? { group_id: newGroupId, subject_id: subjectId } : group,
      ),
      assignments: prev.assignments.map((assignment) =>
        assignment.group_id === oldGroupId ? { ...assignment, group_id: newGroupId } : assignment,
      ),
    }))
    console.log("[v0] Updated group:", { oldGroupId, newGroupId, subjectId })
  }

  const handleAddGroupClick = () => {
    setEditingGroup(null)
    setIsGroupSidebarOpen(true)
  }

  const handleGroupTitleClick = (groupId: string) => {
    const group = data.groups.find((g) => g.group_id === groupId)
    if (group) {
      setEditingGroup(group)
      setIsGroupSidebarOpen(true)
    }
  }

  const closeGroupSidebar = () => {
    setIsGroupSidebarOpen(false)
    setEditingGroup(null)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Assignment Manager</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            <Button onClick={() => setIsEditing(!isEditing)} variant={isEditing ? "destructive" : "default"}>
              {isEditing ? "Exit Edit Mode" : "Enter Edit Mode"}
            </Button>
            <Button onClick={resetData} variant="outline">
              Reset to Default Data
            </Button>
            <div className="text-sm text-muted-foreground flex items-center">
              Total Assignments: {data.assignments.length}
            </div>
            <div className="text-sm text-muted-foreground flex items-center">Click on any assignment to edit</div>
          </div>
        </CardContent>
      </Card>

      <AssignmentGrid
        subjects={data.subjects}
        groups={data.groups}
        units={data.units}
        assignments={data.assignments}
        onAssignmentClick={handleAssignmentClick}
        onEmptyCellClick={handleEmptyCellClick}
        onUnitTitleClick={handleUnitTitleClick}
        onAddGroupClick={handleAddGroupClick}
        onGroupTitleClick={handleGroupTitleClick} // Added group title click handler
      />

      <AssignmentSidebar
        isOpen={isSidebarOpen}
        onClose={closeSidebar}
        assignment={selectedAssignment}
        units={data.units}
        onSave={handleSidebarSave}
        onDelete={handleSidebarDelete}
        onCreate={handleSidebarCreate}
        newAssignmentData={newAssignmentData}
      />

      <GroupSidebar
        isOpen={isGroupSidebarOpen}
        onClose={closeGroupSidebar}
        subjects={data.subjects}
        onSave={addGroup}
        editingGroup={editingGroup} // Added editing props
        onUpdate={updateGroup}
      />

      {isEditing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Data Editor (Debug)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Current Assignments:</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {data.assignments.map((assignment, index) => (
                    <div key={index} className="flex items-center justify-between p-2 border rounded">
                      <div className="text-sm">
                        <span className="font-medium">{assignment.group_id}</span> →
                        <span className="ml-1">{data.units.find((u) => u.unit_id === assignment.unit_id)?.title}</span>
                        <span className="ml-2 text-muted-foreground">
                          ({assignment.start_date} to {assignment.end_date})
                        </span>
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => deleteAssignment(index)}>
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
