"use client"

import { useMemo, useState, useTransition } from "react"
import { AssignmentGrid } from "./assignment-grid"
import { AssignmentSidebar } from "./assignment-sidebar"
import { GroupSidebar } from "./group-sidebar"
import { AssignmentGroupSelectorSidebar } from "./assignment-group-selector-sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Search, X } from "lucide-react"
import { createWildcardRegExp } from "@/lib/utils"
import type {
  Assignment,
  AssignmentChangeEvent,
  Assignments,
  Group,
  Groups,
  Subjects,
  Unit,
  Units,
} from "@/types"
import {
  createAssignmentAction,
  deleteAssignmentAction,
  updateAssignmentAction,
  createGroupAction,
  updateGroupAction,
  deleteGroupAction,
} from "@/lib/server-updates"

import { toast } from "sonner"


export interface AssignmentManagerProps {
  groups?: Groups | null
  subjects?: Subjects | null
  assignments?: Assignments | null
  units?: Units | null
  onChange?: (assignment: Assignment, eventType: AssignmentChangeEvent) => void
}

export function AssignmentManager({ 
    groups: initialGroups, 
    subjects: initialSubjects, 
    assignments: initialAssignments, 
    units: initialUnits,
    onChange }: AssignmentManagerProps) {
  const [groups, setGroups] = useState<Groups>(initialGroups ?? [])
  const subjects = initialSubjects ?? []
  const units = useMemo(() => initialUnits ?? [], [initialUnits])
  const [assignments, setAssignments] = useState<Assignments>(initialAssignments ?? [])
  const [, startTransition] = useTransition()
  //const { toast: showToast } = useToast()
  const [isEditing] = useState(false)
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isGroupSidebarOpen, setIsGroupSidebarOpen] = useState(false)
  const [isGroupSelectorOpen, setIsGroupSelectorOpen] = useState(false)
  const [newAssignmentData, setNewAssignmentData] = useState<{ groupId: string; startDate: string } | undefined>(
    undefined,
  )
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])

  const [searchFilter, setSearchFilter] = useState<string>("")

  const sidebarGroupId = selectedAssignment?.group_id ?? newAssignmentData?.groupId
  const sidebarGroupSubject = useMemo(() => {
    if (!sidebarGroupId) return undefined
    return groups.find((group:Group) => group.group_id === sidebarGroupId)?.subject
  }, [groups, sidebarGroupId])

  const getFilteredAssignments = () => {
    const term = searchFilter.trim()
    if (!term) {
      return assignments
    }

    const searchRegex = createWildcardRegExp(term)
    if (!searchRegex) {
      return assignments
    }

    return assignments.filter((assignment: Assignment) => {
      const groupIdMatch = searchRegex.test(assignment.group_id)

      const unit = units.find((u: Unit) => u.unit_id === assignment.unit_id)
      const unitMatch = unit ? searchRegex.test(unit.title) : false

      const startDateMatch = searchRegex.test(assignment.start_date)
      const endDateMatch = searchRegex.test(assignment.end_date)

      const group = groups.find((g) => g.group_id === assignment.group_id)
      const subjectMatch = group ? searchRegex.test(group.subject) : false

      return groupIdMatch || unitMatch || startDateMatch || endDateMatch || subjectMatch
    })
  }

  const clearFilter = () => {
    setSearchFilter("")
  }

  const hasActiveFilter = () => {
    return searchFilter.trim() !== ""
  }

  const isSameAssignment = (a: Assignment, b: Assignment) =>
    a.group_id === b.group_id && a.unit_id === b.unit_id && a.start_date === b.start_date

  const addAssignment = (newAssignment: Assignment) => {
    const previousAssignments = assignments.map((assignment) => ({ ...assignment }))

    setAssignments((prev: Assignments) => [...prev, newAssignment])
    onChange?.(newAssignment, "create")

    startTransition(async () => {
      try {
        const result = await createAssignmentAction(
          newAssignment.group_id,
          newAssignment.unit_id,
          newAssignment.start_date,
          newAssignment.end_date,
        )

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        setAssignments((prev: Assignments) =>
          prev.map((assignment) => (isSameAssignment(assignment, newAssignment) ? result.data! : assignment)),
        )

        toast.success("Assignment saved to the database.")
      } catch (error) {
        console.error("[v0] Failed to create assignment:", error)
        setAssignments(previousAssignments)
        toast.error("Assignment creation failed", {
          description: "We couldn't save the assignment. Please try again.",
        })
      }
    })
  }

  const updateAssignment = (index: number, updatedAssignment: Assignment, originalAssignment: Assignment) => {
    const previousAssignments = assignments.map((assignment) => ({ ...assignment }))

    setAssignments((prev: Assignments) =>
      prev.map((assignment: Assignment, i: number) => (i === index ? updatedAssignment : assignment)),
    )

    onChange?.(updatedAssignment, "edit")

    startTransition(async () => {
      try {
        const result = await updateAssignmentAction(
          updatedAssignment.group_id,
          updatedAssignment.unit_id,
          updatedAssignment.start_date,
          updatedAssignment.end_date,
          {
            originalUnitId: originalAssignment.unit_id,
            originalStartDate: originalAssignment.start_date,
          },
        )

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        setAssignments((prev: Assignments) =>
          prev.map((assignment: Assignment, i: number) => (i === index ? result.data! : assignment)),
        )

        toast.success("Assignment updated in the database.")
      } catch (error) {
        console.error("[v0] Failed to update assignment:", error)
        setAssignments(previousAssignments)
        toast.error("Assignment update failed", {
          description: "We couldn't update the assignment. Please try again.",
        })
      }
    })
  }

  const deleteAssignment = (index: number) => {
    const assignmentToDelete = assignments[index]
    if (!assignmentToDelete) {
      return
    }

    const previousAssignments = assignments.map((assignment) => ({ ...assignment }))

    setAssignments((prev: Assignments) => prev.filter((_, i) => i !== index))
    onChange?.(assignmentToDelete, "delete")

    startTransition(async () => {
      try {
        const result = await deleteAssignmentAction(
          assignmentToDelete.group_id,
          assignmentToDelete.unit_id,
          assignmentToDelete.start_date,
        )

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        toast.success("Assignment removed from the database.")
      } catch (error) {
        console.error("[v0] Failed to delete assignment:", error)
        setAssignments(previousAssignments)
        toast.error("Assignment deletion failed", {
          description: "We couldn't remove the assignment. Please try again.",
        })
      }
    })
  }

  const handleAssignmentClick = (assignment: Assignment) => {
    setSelectedAssignment(assignment)
    setNewAssignmentData(undefined)
    setSelectedGroupIds([assignment.group_id])
    setIsSidebarOpen(true)
  }

  const handleEmptyCellClick = (groupId: string, weekStart: Date) => {
    setSelectedAssignment(null)
    setNewAssignmentData({
      groupId,
      startDate: weekStart.toISOString().split("T")[0],
    })
    setSelectedGroupIds([groupId])
    setIsSidebarOpen(true)
  }

  const handleUnitTitleClick = (assignment: Assignment) => {
    console.log("[v0] Unit title clicked from hover tooltip:", assignment)
    onChange?.(assignment, "unit-title-click")
  }

  const handleSidebarSave = (updatedAssignment: Assignment) => {
    const index = assignments.findIndex(
      (a:Assignment) =>
        a.group_id === selectedAssignment?.group_id &&
        a.unit_id === selectedAssignment?.unit_id &&
        a.start_date === selectedAssignment?.start_date &&
        a.end_date === selectedAssignment?.end_date,
    )
    if (index !== -1 && selectedAssignment) {
      updateAssignment(index, updatedAssignment, selectedAssignment)
    }
  }

  const handleSidebarDelete = () => {
    const index = assignments.findIndex(
      (a:Assignment) =>
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
    const groupIds = selectedGroupIds.length ? Array.from(new Set(selectedGroupIds)) : [newAssignment.group_id]
    groupIds.forEach((groupId) => {
      addAssignment({ ...newAssignment, group_id: groupId })
    })
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

    setGroups((prev:Groups) => [...prev.filter((group:Group) => group.group_id !== groupName), optimisticGroup])

   
      
    startTransition(async () => {
      try {
        const result = await createGroupAction(groupName, subject)

        if (result.error) {
          toast.error(`Group creation failed :: ${result.error}`);
          return
        }

        const insertedGroup = result.data
        const finalGroup: Group = {
          group_id: insertedGroup?.group_id ?? groupName,
          subject: insertedGroup?.subject ?? subject,
          join_code: insertedGroup?.join_code ?? tempJoinCode,
          active: insertedGroup?.active ?? true,
        }

        setGroups((prev:Groups) =>
          prev.map((group:Group) => (group.group_id === finalGroup.group_id ? finalGroup : group)),
        )

        toast.success(`Group ${groupName} has been saved to the database.`)
      } catch (error) {
        console.error("[v0] Failed to create group:", error)
        setGroups((prev:Groups) => prev.filter((group:Group) => group.group_id !== groupName))
        toast.error("Group creation failed", {
          description: "We couldn't save the group to Supabase. Try again shortly.",
        })
      }
    })
    
  }

  const removeGroup = async (groupId: string) => {
    const groupToRemove = groups.find((group:Group) => group.group_id === groupId)
    if (!groupToRemove) {
      return
    }

    const previousGroups = [...groups]
    const previousAssignments = [...assignments]

    setGroups((prev: Groups) => prev.filter((group: Group) => group.group_id !== groupId))
    setAssignments((prev: Assignments) => prev.filter((assignment: Assignment) => assignment.group_id !== groupId))

    try {
      const result = await deleteGroupAction(groupId)

      if (!result.success) {
        throw new Error(result.error ?? "Failed to deactivate group")
      }

      toast.success(`Group ${groupId} has been removed.`)
    } catch (error) {
      console.error("[v0] Failed to remove group:", error)
      setGroups(previousGroups)
      setAssignments(previousAssignments)
      toast.error("Failed to remove group", {
        description: "We couldn't deactivate the group. Please try again.",
      })
      throw error
    }
  }

  const updateGroup = async (oldGroupId: string, newGroupId: string, subject: string) => {
    startTransition(async () => {
      const previousGroups = [...groups]
      const previousAssignments = [...assignments]

      setGroups((prev) =>
        prev.map((group) =>
          group.group_id === oldGroupId ? { ...group, group_id: newGroupId, subject } : group,
        ),
      )

      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.group_id === oldGroupId ? { ...assignment, group_id: newGroupId } : assignment,
        ),
      )

      try {
        const result = await updateGroupAction(oldGroupId, newGroupId, subject)

        if (result.success) {
          toast.success("Updated Group")
        }
      } catch (error) {
        console.error("[v0] Failed to update group:", error)
        toast.error("Failed to update group in database. Please try again.")
        setGroups(previousGroups)
        setAssignments(previousAssignments)
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
    const term = searchFilter.trim()
    if (!term) {
      return groups
    }

    const filteredAssignments = getFilteredAssignments()
    const groupsWithMatchingAssignments = new Set(filteredAssignments.map((a) => a.group_id))

    const searchRegex = createWildcardRegExp(term)
    if (!searchRegex) {
      return groups
    }

    return groups.filter((group) => {
      const hasMatchingAssignments = groupsWithMatchingAssignments.has(group.group_id)
      const groupIdMatch = searchRegex.test(group.group_id)
      const subjectMatch = searchRegex.test(group.subject)

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
                Showing {filteredAssignments.length} of {assignments.length} assignments
              </div>
            )}
          </div>
        </div>

      <AssignmentGrid
        groups={filteredGroups}
        units={units}
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
        units={units}
        groupSubject={sidebarGroupSubject}
        onSave={handleSidebarSave}
        onDelete={handleSidebarDelete}
        onCreate={handleSidebarCreate}
        newAssignmentData={newAssignmentData}
        selectedGroups={selectedGroupIds}
        onOpenGroupSelection={() => setIsGroupSelectorOpen(true)}
      />

      <GroupSidebar
        isOpen={isGroupSidebarOpen}
        onClose={closeGroupSidebar}
        subjects={subjects}
        onSave={addGroup}
        editingGroup={editingGroup}
        onUpdate={updateGroup}
        onDeactivate={removeGroup}
      />

      <AssignmentGroupSelectorSidebar
        isOpen={isGroupSelectorOpen}
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        onClose={() => setIsGroupSelectorOpen(false)}
        onSave={(ids) => {
          const baseGroupId = selectedAssignment?.group_id ?? newAssignmentData?.groupId
          let normalized = ids
          if (normalized.length === 0 && baseGroupId) {
            normalized = [baseGroupId]
          }
          if (baseGroupId && !normalized.includes(baseGroupId)) {
            normalized = [...normalized, baseGroupId]
          }
          setSelectedGroupIds(Array.from(new Set(normalized)))
          setIsGroupSelectorOpen(false)
        }}
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
                  {assignments.map((assignment, index) => (
                    <div key={index} className="flex items-center justify-between p-2 border rounded">
                      <div className="text-sm">
                        <span className="font-medium">{assignment.group_id}</span> →
                        <span className="ml-1">{units.find((u) => u.unit_id === assignment.unit_id)?.title}</span>
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
