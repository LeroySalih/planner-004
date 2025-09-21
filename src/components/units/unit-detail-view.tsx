"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { Calendar, Edit2, GripVertical, Plus, Target, Users } from "lucide-react"
import { toast } from "sonner"

import type { Assignment, Group, Groups, Subjects, Unit } from "@/types"
import type {
  LearningObjectiveWithCriteria,
  LessonWithObjectives,
} from "@/lib/server-updates"
import { reorderLearningObjectivesAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UnitEditSidebar } from "@/components/units/unit-edit-sidebar"
import { LearningObjectiveSidebar } from "@/components/units/learning-objective-sidebar"
import { LessonsPanel } from "@/components/units/lessons-panel"
import { UnitFilesPanel } from "@/components/units/unit-files-panel"

interface UnitDetailViewProps {
  unit: Unit
  assignments: Assignment[]
  groups: Groups
  subjects: Subjects
  learningObjectives: LearningObjectiveWithCriteria[]
  lessons: LessonWithObjectives[]
  unitFiles: { name: string; path: string; created_at?: string; updated_at?: string; size?: number }[]
}

export function UnitDetailView({
  unit,
  assignments,
  groups,
  subjects,
  learningObjectives,
  lessons,
  unitFiles,
}: UnitDetailViewProps) {
  const [isUnitSidebarOpen, setIsUnitSidebarOpen] = useState(false)
  const [currentUnit, setCurrentUnit] = useState<Unit>(unit)
  const [objectives, setObjectives] = useState<LearningObjectiveWithCriteria[]>(() =>
    sortObjectives(learningObjectives),
  )
  const [selectedObjective, setSelectedObjective] = useState<LearningObjectiveWithCriteria | null>(null)
  const [isObjectiveSidebarOpen, setIsObjectiveSidebarOpen] = useState(false)
  const [draggingObjectiveId, setDraggingObjectiveId] = useState<string | null>(null)
  const [isDraggingObjective, setIsDraggingObjective] = useState(false)
  const [, startReorderTransition] = useTransition()

  useEffect(() => {
    setCurrentUnit(unit)
  }, [unit])

  useEffect(() => {
    setObjectives(sortObjectives(learningObjectives))
  }, [learningObjectives])

  const groupsById = useMemo(() => {
    const map = new Map<string, Group>()
    groups.forEach((group) => {
      map.set(group.group_id, group)
    })
    return map
  }, [groups])

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })

  const isActive = currentUnit.active ?? true
  const statusClassName = isActive
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-rose-100 text-rose-700 border-rose-200"

  const objectiveLessonCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    lessons
      .filter((lesson) => lesson.active !== false)
      .forEach((lesson) => {
        const seen = new Set<string>()
        lesson.lesson_objectives?.forEach((objective) => {
          if (!objective?.learning_objective_id || seen.has(objective.learning_objective_id)) return
          counts[objective.learning_objective_id] = (counts[objective.learning_objective_id] ?? 0) + 1
          seen.add(objective.learning_objective_id)
        })
      })
    return counts
  }, [lessons])

  const openCreateObjective = () => {
    setSelectedObjective(null)
    setIsObjectiveSidebarOpen(true)
  }

  const openEditObjective = (objective: LearningObjectiveWithCriteria) => {
    if (isDraggingObjective) return
    setSelectedObjective(objective)
    setIsObjectiveSidebarOpen(true)
  }

  const handleObjectiveSaved = (objective: LearningObjectiveWithCriteria) => {
    setObjectives((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.learning_objective_id === objective.learning_objective_id,
      )

      const ensureOrderBy = (
        candidate: LearningObjectiveWithCriteria,
        fallback: number,
      ): LearningObjectiveWithCriteria =>
        candidate.order_by === null || candidate.order_by === undefined
          ? { ...candidate, order_by: fallback }
          : candidate

      if (existingIndex !== -1) {
        const next = [...prev]
        next[existingIndex] = ensureOrderBy(objective, prev[existingIndex]?.order_by ?? existingIndex)
        return sortObjectives(next)
      }

      const next = [...prev, ensureOrderBy(objective, prev.length)]
      return sortObjectives(next)
    })
    setSelectedObjective(objective)
  }

  const handleObjectiveDeleted = (learningObjectiveId: string) => {
    setObjectives((prev) => prev.filter((item) => item.learning_objective_id !== learningObjectiveId))
    setSelectedObjective(null)
  }

  const handleDragStartObjective = (
    objectiveId: string,
    event: React.DragEvent<HTMLButtonElement>,
  ) => {
    setDraggingObjectiveId(objectiveId)
    setIsDraggingObjective(true)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", objectiveId)
  }

  const handleDragEndObjective = () => {
    setDraggingObjectiveId(null)
    setIsDraggingObjective(false)
  }

  const handleDropObjective = (targetObjectiveId: string | null) => (
    event: React.DragEvent<HTMLDivElement | HTMLButtonElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()

    if (!draggingObjectiveId || draggingObjectiveId === targetObjectiveId) {
      handleDragEndObjective()
      return
    }

    const result = reorderObjectiveList(objectives, draggingObjectiveId, targetObjectiveId)

    if (!result) {
      handleDragEndObjective()
      return
    }

    const { updatedObjectives, payload } = result
    const previousObjectives = objectives

    setObjectives(updatedObjectives)
    handleDragEndObjective()

    startReorderTransition(async () => {
      const response = await reorderLearningObjectivesAction(currentUnit.unit_id, payload)
      if (!response.success) {
        toast.error("Failed to update learning objective order", {
          description: response.error ?? "Please try again shortly.",
        })
        setObjectives(previousObjectives)
      }
    })
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-balance">{currentUnit.title}</h1>
              <Badge variant="outline" className={statusClassName}>
                {isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <Badge variant="outline">Subject: {currentUnit.subject}</Badge>
              <span className="text-sm">Unit ID: {currentUnit.unit_id}</span>
            </div>
          </div>
          <Button onClick={() => setIsUnitSidebarOpen(true)} className="self-start">
            <Edit2 className="mr-2 h-4 w-4" />
            Edit Unit
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Description</CardTitle>
          </CardHeader>
          <CardContent>
            {currentUnit.description ? (
              <p className="leading-relaxed text-muted-foreground whitespace-pre-line">{currentUnit.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No description has been provided for this unit yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl font-semibold">
              <Target className="h-5 w-5 text-primary" />
              Learning Objectives
            </CardTitle>
            <CardDescription>Each objective can include up to three success criteria.</CardDescription>
          </div>
          <Button size="sm" onClick={openCreateObjective}>
            <Plus className="mr-2 h-4 w-4" />
            Add Objective
          </Button>
        </CardHeader>
        <CardContent onDragOver={(event) => event.preventDefault()} onDrop={handleDropObjective(null)}>
          {objectives.length > 0 ? (
            <div className="space-y-3">
              {objectives.map((objective) => {
                const lessonCount = objectiveLessonCounts[objective.learning_objective_id] ?? 0
                const label = lessonCount === 1 ? "lesson" : "lessons"

                return (
                  <button
                    key={objective.learning_objective_id}
                    type="button"
                    draggable
                    onClick={() => openEditObjective(objective)}
                    onDragStart={(event) =>
                      handleDragStartObjective(objective.learning_objective_id, event)
                    }
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDropObjective(objective.learning_objective_id)}
                    onDragEnd={handleDragEndObjective}
                    className={cn(
                      "w-full rounded-lg border border-border p-4 text-left transition hover:border-primary cursor-grab active:cursor-grabbing",
                      draggingObjectiveId === objective.learning_objective_id && "opacity-60",
                    )}
                    aria-grabbed={draggingObjectiveId === objective.learning_objective_id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium">{objective.title}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {lessonCount} {label}
                      </span>
                    </div>
                    {lessonCount === 0 && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        This objective is not linked to any lessons yet.
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No learning objectives yet. Click “Add Objective” to create the first one.
            </div>
          )}
        </CardContent>
      </Card>

      <LessonsPanel
        unitId={currentUnit.unit_id}
        initialLessons={lessons}
        learningObjectives={objectives}
      />

      <UnitFilesPanel unitId={currentUnit.unit_id} initialFiles={unitFiles} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <Users className="h-5 w-5 text-primary" />
            Related Assignments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {assignments.length > 0 ? (
            assignments.map((assignment) => {
              const group = groupsById.get(assignment.group_id)
              return (
                <div
                  key={`${assignment.group_id}-${assignment.unit_id}-${assignment.start_date}`}
                  className="flex flex-col gap-1 rounded-lg border border-border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      Group: {assignment.group_id}
                      {group?.subject && (
                        <span className="ml-2 text-muted-foreground">({group.subject})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {formatDate(assignment.start_date)} – {formatDate(assignment.end_date)}
                      </span>
                      {group?.join_code && (
                        <Badge variant="outline">Join Code: {group.join_code}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-muted-foreground">
              <p className="font-medium">No assignments are linked to this unit yet.</p>
              <p className="text-sm">Return to the assignments dashboard to schedule this unit with a group.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <UnitEditSidebar
        unit={currentUnit}
        subjects={subjects}
        isOpen={isUnitSidebarOpen}
        onClose={() => setIsUnitSidebarOpen(false)}
        onOptimisticUpdate={setCurrentUnit}
      />

      <LearningObjectiveSidebar
        unitId={currentUnit.unit_id}
        learningObjective={selectedObjective}
        isOpen={isObjectiveSidebarOpen}
        onClose={() => setIsObjectiveSidebarOpen(false)}
        onCreateOrUpdate={handleObjectiveSaved}
        onDelete={handleObjectiveDeleted}
      />
    </>
  )
}

function sortObjectives(objectives: LearningObjectiveWithCriteria[]) {
  return [...objectives].sort((a, b) => {
    const aOrder = a.order_by ?? Number.MAX_SAFE_INTEGER
    const bOrder = b.order_by ?? Number.MAX_SAFE_INTEGER
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }
    return a.title.localeCompare(b.title)
  })
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = [...array]
  if (from < 0 || from >= result.length) return result
  const [item] = result.splice(from, 1)
  let target = to
  if (target < 0) target = 0
  if (target > result.length) target = result.length
  result.splice(target, 0, item)
  return result
}

function reorderObjectiveList(
  objectives: LearningObjectiveWithCriteria[],
  draggedObjectiveId: string,
  targetObjectiveId: string | null,
):
  | {
      updatedObjectives: LearningObjectiveWithCriteria[]
      payload: { learningObjectiveId: string; orderBy: number }[]
    }
  | null {
  const orderedObjectives = sortObjectives(objectives)

  const fromIndex = orderedObjectives.findIndex(
    (objective) => objective.learning_objective_id === draggedObjectiveId,
  )
  if (fromIndex === -1) {
    return null
  }

  let toIndex = targetObjectiveId
    ? orderedObjectives.findIndex((objective) => objective.learning_objective_id === targetObjectiveId)
    : orderedObjectives.length - 1

  if (toIndex === -1) {
    toIndex = orderedObjectives.length - 1
  }

  if (fromIndex === toIndex) {
    return null
  }

  const reordered = arrayMove(orderedObjectives, fromIndex, toIndex).map((objective, index) => ({
    ...objective,
    order_by: index,
  }))

  const payload = reordered.map((objective) => ({
    learningObjectiveId: objective.learning_objective_id,
    orderBy: objective.order_by ?? 0,
  }))

  return {
    updatedObjectives: reordered,
    payload,
  }
}
