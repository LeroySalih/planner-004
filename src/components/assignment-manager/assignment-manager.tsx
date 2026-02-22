"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import { AssignmentGrid } from "./assignment-grid"
import { AssignmentSidebar } from "./assignment-sidebar"
import { GroupSidebar } from "./group-sidebar"
import { AssignmentGroupSelectorSidebar } from "./assignment-group-selector-sidebar"
import { DateCommentsSidebar } from "./date-comments-sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Search, X, Eye, EyeOff } from "lucide-react"
import { createWildcardRegExp, normalizeAssignmentWeek, normalizeDateOnly } from "@/lib/utils"
import type {
  Assignment,
  AssignmentChangeEvent,
  Assignments,
  DateComment,
  DateComments,
  Group,
  Groups,
  LessonAssignment,
  LessonAssignments,
  Lessons,
  LessonAssignmentScoreSummaries,
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
  upsertLessonAssignmentAction,
  deleteLessonAssignmentAction,
  toggleLessonAssignmentLockedAction,
  toggleLessonAssignmentVisibilityAction,
  createDateCommentAction,
  updateDateCommentAction,
  deleteDateCommentAction,
} from "@/lib/server-updates"

import { toast } from "sonner"

const lessonAssignmentKey = (groupId: string, lessonId: string) => `${groupId}__${lessonId}`


export interface AssignmentManagerProps {
  groups?: Groups | null
  subjects?: Subjects | null
  assignments?: Assignments | null
  units?: Units | null
  lessons?: Lessons | null
  lessonAssignments?: LessonAssignments | null
  lessonScoreSummaries?: LessonAssignmentScoreSummaries | null
  dateComments?: DateComments | null
  onChange?: (assignment: Assignment, eventType: AssignmentChangeEvent) => void
}

export function AssignmentManager({
    groups: initialGroups,
    subjects: initialSubjects,
    assignments: initialAssignments,
    units: initialUnits,
    lessons: initialLessons,
    lessonAssignments: initialLessonAssignments,
    lessonScoreSummaries: initialLessonScoreSummaries,
    dateComments: initialDateComments,
    onChange }: AssignmentManagerProps) {

  const normalizeAssignmentDates = (assignment: Assignment): Assignment => {
    const snapped = normalizeAssignmentWeek(assignment.start_date, assignment.end_date)
    return {
      ...assignment,
      start_date: snapped?.start ?? normalizeDateOnly(assignment.start_date) ?? assignment.start_date,
      end_date: snapped?.end ?? normalizeDateOnly(assignment.end_date) ?? assignment.end_date,
    }
  }

  const normalizeAssignments = (entries: Assignments | null | undefined) =>
    (entries ?? []).map((entry) => normalizeAssignmentDates(entry))

  const normalizeLessonAssignments = (entries: LessonAssignments | null | undefined) =>
    (entries ?? []).map((entry) => ({
      ...entry,
      start_date: normalizeDateOnly(entry.start_date) ?? entry.start_date,
    }))

  const formatDateInputValue = (value: Date) => {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const [groups, setGroups] = useState<Groups>(initialGroups ?? [])
  const subjects = initialSubjects ?? []
  const units = useMemo(() => initialUnits ?? [], [initialUnits])
  const lessons = useMemo(() => initialLessons ?? [], [initialLessons])
  const [assignments, setAssignments] = useState<Assignments>(normalizeAssignments(initialAssignments))
  const [lessonAssignments, setLessonAssignments] = useState<LessonAssignments>(
    normalizeLessonAssignments(initialLessonAssignments),
  )
  const lessonScoreSummaries = useMemo(
    () => initialLessonScoreSummaries ?? [],
    [initialLessonScoreSummaries],
  )
  const [, startTransition] = useTransition()
  //const { toast: showToast } = useToast()
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isGroupSidebarOpen, setIsGroupSidebarOpen] = useState(false)
  const [isGroupSelectorOpen, setIsGroupSelectorOpen] = useState(false)
  const [newAssignmentData, setNewAssignmentData] = useState<{ groupId: string; startDate: string } | undefined>(
    undefined,
  )
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [pendingLessonAssignmentKeys, setPendingLessonAssignmentKeys] = useState<Record<string, boolean>>({})
  const [dateComments, setDateComments] = useState<DateComments>(initialDateComments ?? [])
  const [isDateCommentsSidebarOpen, setIsDateCommentsSidebarOpen] = useState(false)
  const [selectedCommentDate, setSelectedCommentDate] = useState<string | null>(null)
  const updateLessonAssignmentState = useCallback(
    (groupId: string, lessonId: string, startDate: string | null) => {
      setLessonAssignments((prev: LessonAssignments) => {
        const map = new Map(
          prev.map((entry) => [lessonAssignmentKey(entry.group_id, entry.lesson_id), entry] as const),
        )
        const key = lessonAssignmentKey(groupId, lessonId)
        const normalizedDate = normalizeDateOnly(startDate) ?? startDate

        if (normalizedDate) {
          const existing = map.get(key)
          map.set(key, {
            group_id: groupId,
            lesson_id: lessonId,
            start_date: normalizedDate,
            hidden: existing?.hidden ?? false,
            locked: existing?.locked ?? false,
          })
        } else {
          map.delete(key)
        }

        return Array.from(map.values())
      })
    },
    [],
  )

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
    const snappedDates = normalizeAssignmentWeek(newAssignment.start_date, newAssignment.end_date)
    const normalizedAssignment = normalizeAssignmentDates({
      ...newAssignment,
      start_date: snappedDates?.start ?? newAssignment.start_date,
      end_date: snappedDates?.end ?? newAssignment.end_date,
    })
    const previousAssignments = assignments.map((assignment) => ({ ...assignment }))

    setAssignments((prev: Assignments) => [...prev, normalizedAssignment])
    onChange?.(normalizedAssignment, "create")

    startTransition(async () => {
      try {
        const result = await createAssignmentAction(
          normalizedAssignment.group_id,
          normalizedAssignment.unit_id,
          normalizedAssignment.start_date,
          normalizedAssignment.end_date,
        )

        if (result.error || !result.data) {
          setAssignments(previousAssignments)
          toast.error("Assignment creation failed", {
            description: result.error ?? "We couldn't save the assignment. Please try again.",
          })
          return
        }

        const savedAssignment = normalizeAssignmentDates(result.data)

        setAssignments((prev: Assignments) =>
          prev.map((assignment) =>
            isSameAssignment(assignment, normalizedAssignment) ? savedAssignment : assignment,
          ),
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
    const snappedDates = normalizeAssignmentWeek(updatedAssignment.start_date, updatedAssignment.end_date)
    const normalizedUpdate = normalizeAssignmentDates({
      ...updatedAssignment,
      start_date: snappedDates?.start ?? updatedAssignment.start_date,
      end_date: snappedDates?.end ?? updatedAssignment.end_date,
    })
    const previousAssignments = assignments.map((assignment) => ({ ...assignment }))

    setAssignments((prev: Assignments) =>
      prev.map((assignment: Assignment, i: number) => (i === index ? normalizedUpdate : assignment)),
    )

    onChange?.(normalizedUpdate, "edit")

    startTransition(async () => {
      try {
        const result = await updateAssignmentAction(
          normalizedUpdate.group_id,
          normalizedUpdate.unit_id,
          normalizedUpdate.start_date,
          normalizedUpdate.end_date,
          {
            originalUnitId: originalAssignment.unit_id,
            originalStartDate: originalAssignment.start_date,
          },
        )

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        const savedAssignment = normalizeAssignmentDates(result.data)

        setAssignments((prev: Assignments) =>
          prev.map((assignment: Assignment, i: number) => (i === index ? savedAssignment : assignment)),
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

  const upsertLessonAssignment = (groupId: string, lessonId: string, startDate: string) => {
    const normalizedStartDate = normalizeDateOnly(startDate) ?? startDate
    const previousLessonAssignments = lessonAssignments.map((entry) => ({ ...entry }))
    const key = lessonAssignmentKey(groupId, lessonId)

    updateLessonAssignmentState(groupId, lessonId, normalizedStartDate)

    setPendingLessonAssignmentKeys((prev) => ({ ...prev, [key]: true }))

    startTransition(async () => {
      try {
        const result = await upsertLessonAssignmentAction(groupId, lessonId, normalizedStartDate)

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        updateLessonAssignmentState(groupId, lessonId, result.data.start_date)

        toast.success("Lesson schedule saved to the database.")
      } catch (error) {
        console.error("[v0] Failed to upsert lesson assignment:", error)
        setLessonAssignments(previousLessonAssignments)
        toast.error("Lesson scheduling failed", {
          description: "We couldn't save the lesson date. Please try again.",
        })
      } finally {
        setPendingLessonAssignmentKeys((prev) => {
          const updated = { ...prev }
          delete updated[key]
          return updated
        })
      }
    })
  }

  const deleteLessonAssignment = (groupId: string, lessonId: string) => {
    const existingIndex = lessonAssignments.findIndex(
      (entry: LessonAssignment) => entry.group_id === groupId && entry.lesson_id === lessonId,
    )

    if (existingIndex === -1) {
      return
    }

    const previousLessonAssignments = lessonAssignments.map((entry) => ({ ...entry }))
    const key = lessonAssignmentKey(groupId, lessonId)

    updateLessonAssignmentState(groupId, lessonId, null)
    setPendingLessonAssignmentKeys((prev) => ({ ...prev, [key]: true }))

    startTransition(async () => {
      try {
        const result = await deleteLessonAssignmentAction(groupId, lessonId)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        toast.success("Lesson date removed from the database.")
      } catch (error) {
        console.error("[v0] Failed to delete lesson assignment:", error)
        setLessonAssignments(previousLessonAssignments)
        toast.error("Lesson date removal failed", {
          description: "We couldn't remove the lesson date. Please try again.",
        })
      } finally {
        setPendingLessonAssignmentKeys((prev) => {
          const updated = { ...prev }
          delete updated[key]
          return updated
        })
      }
    })
  }

  const handleToggleHidden = (groupId: string, lessonId: string, currentHidden: boolean) => {
    const key = lessonAssignmentKey(groupId, lessonId)
    const newHidden = !currentHidden
    
    // Optimistic update
    setLessonAssignments((prev) => 
      prev.map((entry) => 
        entry.group_id === groupId && entry.lesson_id === lessonId
          ? { ...entry, hidden: newHidden }
          : entry
      )
    )

    setPendingLessonAssignmentKeys((prev) => ({ ...prev, [key]: true }))

    startTransition(async () => {
      try {
        const result = await toggleLessonAssignmentVisibilityAction(groupId, lessonId, newHidden)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        toast.success(`Lesson is now ${newHidden ? 'hidden' : 'visible'}.`)
      } catch (error) {
        console.error("[v0] Failed to toggle lesson visibility:", error)
        // Revert optimistic update
        setLessonAssignments((prev) => 
          prev.map((entry) => 
            entry.group_id === groupId && entry.lesson_id === lessonId
              ? { ...entry, hidden: currentHidden }
              : entry
          )
        )
        toast.error("Failed to update visibility", {
          description: "We couldn't update the lesson visibility. Please try again.",
        })
      } finally {
        setPendingLessonAssignmentKeys((prev) => {
          const updated = { ...prev }
          delete updated[key]
          return updated
        })
      }
    })
  }

  const handleToggleLocked = (groupId: string, lessonId: string, currentLocked: boolean) => {
    const key = lessonAssignmentKey(groupId, lessonId)
    const newLocked = !currentLocked

    // Optimistic update
    setLessonAssignments((prev) =>
      prev.map((entry) =>
        entry.group_id === groupId && entry.lesson_id === lessonId
          ? { ...entry, locked: newLocked }
          : entry
      )
    )

    setPendingLessonAssignmentKeys((prev) => ({ ...prev, [key]: true }))

    startTransition(async () => {
      try {
        const result = await toggleLessonAssignmentLockedAction(groupId, lessonId, newLocked)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        toast.success(`Lesson is now ${newLocked ? 'locked' : 'unlocked'}.`)
      } catch (error) {
        console.error("[v0] Failed to toggle lesson locked:", error)
        // Revert optimistic update
        setLessonAssignments((prev) =>
          prev.map((entry) =>
            entry.group_id === groupId && entry.lesson_id === lessonId
              ? { ...entry, locked: currentLocked }
              : entry
          )
        )
        toast.error("Failed to update locked status", {
          description: "We couldn't update the lesson lock. Please try again.",
        })
      } finally {
        setPendingLessonAssignmentKeys((prev) => {
          const updated = { ...prev }
          delete updated[key]
          return updated
        })
      }
    })
  }

  const handleDateClick = (dateString: string) => {
    setSelectedCommentDate(dateString)
    setIsDateCommentsSidebarOpen(true)
  }

  const commentsForSelectedDate = useMemo(
    () => dateComments.filter((c) => c.comment_date === selectedCommentDate),
    [dateComments, selectedCommentDate],
  )

  const dateCommentsByDate = useMemo(() => {
    const map = new Map<string, DateComment[]>()
    dateComments.forEach((c) => {
      if (!map.has(c.comment_date)) map.set(c.comment_date, [])
      map.get(c.comment_date)!.push(c)
    })
    return map
  }, [dateComments])

  const handleCreateDateComment = (commentDate: string, comment: string) => {
    const optimisticId = `temp-${Date.now()}`
    const optimistic: DateComment = {
      date_comment_id: optimisticId,
      comment_date: commentDate,
      comment,
      created_by: "",
      created_at: new Date().toISOString(),
    }
    const previous = [...dateComments]
    setDateComments((prev) => [...prev, optimistic])

    startTransition(async () => {
      try {
        const result = await createDateCommentAction(commentDate, comment)
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }
        setDateComments((prev) =>
          prev.map((c) => (c.date_comment_id === optimisticId ? result.data! : c)),
        )
        toast.success("Comment saved.")
      } catch (error) {
        console.error("[date-comments] Failed to create:", error)
        setDateComments(previous)
        toast.error("Failed to save comment.")
      }
    })
  }

  const handleUpdateDateComment = (dateCommentId: string, comment: string) => {
    const previous = [...dateComments]
    setDateComments((prev) =>
      prev.map((c) => (c.date_comment_id === dateCommentId ? { ...c, comment } : c)),
    )

    startTransition(async () => {
      try {
        const result = await updateDateCommentAction(dateCommentId, comment)
        if (!result.success || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }
        setDateComments((prev) =>
          prev.map((c) => (c.date_comment_id === dateCommentId ? result.data! : c)),
        )
        toast.success("Comment updated.")
      } catch (error) {
        console.error("[date-comments] Failed to update:", error)
        setDateComments(previous)
        toast.error("Failed to update comment.")
      }
    })
  }

  const handleDeleteDateComment = (dateCommentId: string) => {
    const previous = [...dateComments]
    setDateComments((prev) => prev.filter((c) => c.date_comment_id !== dateCommentId))

    startTransition(async () => {
      try {
        const result = await deleteDateCommentAction(dateCommentId)
        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }
        toast.success("Comment deleted.")
      } catch (error) {
        console.error("[date-comments] Failed to delete:", error)
        setDateComments(previous)
        toast.error("Failed to delete comment.")
      }
    })
  }

  const closeDateCommentsSidebar = () => {
    setIsDateCommentsSidebarOpen(false)
    setSelectedCommentDate(null)
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
      startDate: formatDateInputValue(weekStart),
    })
    setSelectedGroupIds([groupId])
    setIsSidebarOpen(true)
  }

  const handleLessonDateChange = (lessonId: string, startDate: string | null) => {
    if (!sidebarGroupId) {
      return
    }

    const normalizedDate = normalizeDateOnly(startDate)

    if (!normalizedDate) {
      deleteLessonAssignment(sidebarGroupId, lessonId)
      return
    }

    upsertLessonAssignment(sidebarGroupId, lessonId, normalizedDate)
    setLessonAssignments((prev) => {
      const existing = prev.find(entry => entry.group_id === sidebarGroupId && entry.lesson_id === lessonId)
      const next = prev.filter(
        (entry) => !(entry.group_id === sidebarGroupId && entry.lesson_id === lessonId),
      )
      next.push({
        group_id: sidebarGroupId,
        lesson_id: lessonId,
        start_date: normalizedDate,
        hidden: existing?.hidden ?? false,
        locked: existing?.locked ?? false,
      })
      return next
    })
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
      

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
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
        {hasActiveFilter() && (
          <Button
            onClick={clearFilter}
            variant="ghost"
            size="sm"
            className="h-9 px-3 hover:bg-muted"
          >
            <X className="h-4 w-4 mr-2" />
            Clear
          </Button>
        )}
      </div>

        <AssignmentGrid
          groups={filteredGroups}
          units={units}
          assignments={filteredAssignments}
          lessons={lessons}
          lessonAssignments={lessonAssignments}
          lessonScoreSummaries={lessonScoreSummaries}
          onAssignmentClick={handleAssignmentClick}
          onEmptyCellClick={handleEmptyCellClick}
          onAddGroupClick={handleAddGroupClick}
          onGroupTitleClick={handleGroupTitleClick}
          onToggleHidden={handleToggleHidden}
          onToggleLocked={handleToggleLocked}
          onDateClick={handleDateClick}
          dateCommentsByDate={dateCommentsByDate}
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
        lessons={lessons}
        lessonAssignments={lessonAssignments}
        onLessonDateChange={handleLessonDateChange}
        pendingLessonAssignmentKeys={pendingLessonAssignmentKeys}
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

        <DateCommentsSidebar
        isOpen={isDateCommentsSidebarOpen}
        onClose={closeDateCommentsSidebar}
        selectedDate={selectedCommentDate}
        comments={commentsForSelectedDate}
        onCreate={handleCreateDateComment}
        onUpdate={handleUpdateDateComment}
        onDelete={handleDeleteDateComment}
      />
    </div>
  )
}
