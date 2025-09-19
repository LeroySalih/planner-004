"use client"

import { useState, useTransition } from "react"
import { AssignmentGrid } from "./assignment-grid"
import { AssignmentSidebar } from "./assignment-sidebar"
import { GroupSidebar } from "./group-sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Search, X } from "lucide-react"
import type { Assignment, AssignmentChangeEvent, EducationalData } from "@/types/assignment"
import { initialData } from "@/data/sample-data"
import { createGroupAction, updateGroupAction, deleteGroupAction } from "@/lib/server-updates"
import { Group, Groups } from "@/actions/groups/types";

import { toast  } from "sonner"

export interface AssignmentManagerProps {
  groups?: Groups | null
  onChange?: (assignment: Assignment, eventType: AssignmentChangeEvent) => void
}

export function AssignmentManager({ groups: initialGroups, onChange }: AssignmentManagerProps) {
  const [groups, setGroups] = useState<Groups>(initialGroups ?? [])
  const [data, setData] = useState<EducationalData>(initialData)
  const [, startTransition] = useTransition()
  //const { toast: showToast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isGroupSidebarOpen, setIsGroupSidebarOpen] = useState(false)
  const [newAssignmentData, setNewAssignmentData] = useState<{ groupId: string; startDate: string } | undefined>(
    undefined,
  )
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)

  const [searchFilter, setSearchFilter] = useState<string>("")

  const getFilteredAssignments = () => {
    if (!searchFilter.trim()) {
      return data.assignments
    }

    const searchTerm = searchFilter.toLowerCase().trim()

    return data.assignments.filter((assignment) => {
      const groupIdMatch = assignment.group_id.toLowerCase().includes(searchTerm)

      // Search in unit title
      const unit = data.units.find((u) => u.unit_id === assignment.unit_id)
      const unitMatch = unit?.title.toLowerCase().includes(searchTerm) || false

      // Search in dates (formatted as readable strings)
      const startDateMatch = assignment.start_date.includes(searchTerm)
      const endDateMatch = assignment.end_date.includes(searchTerm)

      // Search in subject
      const group = groups.find((g) => g.group_id === assignment.group_id)
      const subjectMatch = group?.subject.toLowerCase().includes(searchTerm) || false

      return groupIdMatch || unitMatch || startDateMatch || endDateMatch || subjectMatch
    })
  }

  const clearFilter = () => {
    setSearchFilter("")
  }

  const hasActiveFilter = () => {
    return searchFilter.trim() !== ""
  }

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
    setNewAssignmentData(undefined)
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
    setNewAssignmentData(undefined)
  }

  const addGroup = async (groupName: string, subject: string) => {
    const tempJoinCode = Math.random().toString(36).substring(2, 7).toUpperCase()
    const optimisticGroup: Group = {
      group_id: groupName,
      subject,
      join_code: tempJoinCode,
      active: true,
    }

    setGroups((prev) => [...prev.filter((group) => group.group_id !== groupName), optimisticGroup])

    startTransition(async () => {
      try {
        const result = await createGroupAction(groupName, subject)

        if (result.error) {
          throw new Error(result.error)
        }

        const insertedGroup = result.data
        const finalGroup: Group = {
          group_id: insertedGroup?.group_id ?? groupName,
          subject: insertedGroup?.subject ?? subject,
          join_code: insertedGroup?.join_code ?? tempJoinCode,
          active: insertedGroup?.active ?? true,
        }

        setGroups((prev) =>
          prev.map((group) => (group.group_id === finalGroup.group_id ? finalGroup : group)),
        )

        toast.success(`Group ${groupName} has been saved to the database.`)
      } catch (error) {
        console.error("[v0] Failed to create group:", error)
        setGroups((prev) => prev.filter((group) => group.group_id !== groupName))
        toast.error("Group creation failed", {
          description: "We couldn't save the group to Supabase. Try again shortly.",
        })
      }
    })

    console.log("[v0] Added new group optimistically:", optimisticGroup)
  }

  const removeGroup = async (groupId: string) => {
    const groupToRemove = groups.find((group) => group.group_id === groupId)
    if (!groupToRemove) {
      return
    }

    const previousGroups = [...groups]
    const previousAssignments = [...data.assignments]

    setGroups((prev) => prev.filter((group) => group.group_id !== groupId))
    setData((prev) => ({
      ...prev,
      assignments: prev.assignments.filter((assignment) => assignment.group_id !== groupId),
    }))

    try {
      const result = await deleteGroupAction(groupId)

      if (!result.success) {
        throw new Error(result.error ?? "Failed to deactivate group")
      }

      toast.success(`Group ${groupId} has been removed.`)
    } catch (error) {
      console.error("[v0] Failed to remove group:", error)
      setGroups(previousGroups)
      setData((prev) => ({
        ...prev,
        assignments: previousAssignments,
      }))
      toast.error("Failed to remove group", {
        description: "We couldn't deactivate the group. Please try again.",
      })
      throw error
    }
  }

  const updateGroup = async (oldGroupId: string, newGroupId: string, subject: string) => {
    
    startTransition(async () => {

      setGroups((prev) => prev.map((group) =>
          group.group_id === oldGroupId ? { ...group, group_id: newGroupId, subject: subject } : group,
        ));

      setData((prev) => ({
        ...prev,
        assignments: prev.assignments.map((assignment) =>
          assignment.group_id === oldGroupId ? { ...assignment, group_id: newGroupId } : assignment,
        ),
      }))

      try {
        const result = await updateGroupAction(oldGroupId, newGroupId, subject)

        if (result.success) {
         toast.success("Updated Group");
        }
      } catch (error) {
        toast.error("Failed to update group in database. Please try again.")

        setGroups((prev) => groups.map((group) =>
            group.group_id === newGroupId ? { ...group, group_id: oldGroupId, subject: subject } : group,
          ) );

        setData((prev) => ({
          ...prev,
          
          assignments: prev.assignments.map((assignment) =>
            assignment.group_id === newGroupId ? { ...assignment, group_id: oldGroupId } : assignment,
          ),
        }))
      }
    })

    console.log("[v0] Updated group optimistically:", { oldGroupId, newGroupId, subject })
  }

  const handleAddGroupClick = () => {
    setEditingGroup(null)
    setIsGroupSidebarOpen(true)
  }

  const handleGroupTitleClick = (groupId: string) => {
    const group = groups.find((g) => g.group_id === groupId)
    if (group) {
      setEditingGroup(group)
      setIsGroupSidebarOpen(true)
    }
  }

  const closeGroupSidebar = () => {
    setIsGroupSidebarOpen(false)
    setEditingGroup(null)
  }

  const getFilteredGroups = () => {
    if (!searchFilter.trim()) {
      return groups
    }

    const filteredAssignments = getFilteredAssignments()
    const groupsWithMatchingAssignments = new Set(filteredAssignments.map((a) => a.group_id))

    const searchTerm = searchFilter.toLowerCase().trim()

    return groups.filter((group) => {
      // Show group if it has matching assignments
      const hasMatchingAssignments = groupsWithMatchingAssignments.has(group.group_id)

      // Also show group if the group ID itself matches the search
      const groupIdMatch = group.group_id.toLowerCase().includes(searchTerm)

      // Show group if subject matches
      const subjectMatch = group.subject.toLowerCase().includes(searchTerm)

      return hasMatchingAssignments || groupIdMatch || subjectMatch
    })
  }

  const filteredAssignments = getFilteredAssignments()
  const filteredGroups = getFilteredGroups()

  return (
    <div className="space-y-6">
      

      <div>
          <div className="flex items-center justify-between">
            
            {hasActiveFilter() && (
              <Button
                onClick={clearFilter}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 bg-transparent"
              >
                <X className="h-4 w-4" />
                Clear Filter
              </Button>
            )}
          </div>
        
          <div className="">
            <div className="">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search-filter"
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search by group name, unit title, date, or subject..."
                  className="pl-10"
                />
              </div>
            </div>

            {hasActiveFilter() && (
              <div className="text-sm text-muted-foreground">
                Showing {filteredAssignments.length} of {data.assignments.length} assignments
              </div>
            )}
          </div>
        </div>

      <AssignmentGrid
        subjects={data.subjects}
        groups={filteredGroups}
        units={data.units}
        assignments={filteredAssignments}
        onAssignmentClick={handleAssignmentClick}
        onEmptyCellClick={handleEmptyCellClick}
        onUnitTitleClick={handleUnitTitleClick}
        onAddGroupClick={handleAddGroupClick}
        onGroupTitleClick={handleGroupTitleClick}
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
        editingGroup={editingGroup}
        onUpdate={updateGroup}
        onDeactivate={removeGroup}
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
