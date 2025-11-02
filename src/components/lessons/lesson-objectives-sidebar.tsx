"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { X } from "lucide-react"

import type { LearningObjectiveWithCriteria, LessonWithObjectives } from "@/lib/server-updates"
import type { LessonSuccessCriterion } from "@/types"
import { setLessonSuccessCriteriaAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"

interface LessonObjectivesSidebarProps {
  unitId: string
  lesson: LessonWithObjectives
  learningObjectives: LearningObjectiveWithCriteria[]
  selectedSuccessCriteria: LessonSuccessCriterion[]
  isOpen: boolean
  onClose: () => void
  onUpdate: (lesson: LessonWithObjectives) => void
}

type ObjectiveSelectionState = "none" | "partial" | "all"

export function LessonObjectivesSidebar({
  unitId,
  lesson,
  learningObjectives,
  selectedSuccessCriteria,
  isOpen,
  onClose,
  onUpdate,
}: LessonObjectivesSidebarProps) {
  const [selectedCriteriaIds, setSelectedCriteriaIds] = useState<string[]>(() =>
    selectedSuccessCriteria.map((criterion) => criterion.success_criteria_id),
  )
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setSelectedCriteriaIds(selectedSuccessCriteria.map((criterion) => criterion.success_criteria_id))
  }, [selectedSuccessCriteria])

  const objectiveSelections = useMemo(() => {
    const selectedSet = new Set(selectedCriteriaIds)

    return learningObjectives.map((objective) => {
      const criteria = objective.success_criteria ?? []
      const criterionIds = criteria.map((criterion) => criterion.success_criteria_id)
      const selectedCount = criterionIds.filter((id) => selectedSet.has(id)).length

      let state: ObjectiveSelectionState = "none"
      if (selectedCount === criterionIds.length && criterionIds.length > 0) {
        state = "all"
      } else if (selectedCount > 0) {
        state = "partial"
      }

      return {
        objective,
        criteria,
        criterionIds,
        state,
      }
    })
  }, [learningObjectives, selectedCriteriaIds])

  const toggleObjective = (objectiveId: string, nextChecked: boolean) => {
    const objective = learningObjectives.find(
      (entry) => entry.learning_objective_id === objectiveId,
    )
    if (!objective) {
      return
    }

    const criterionIds = (objective.success_criteria ?? []).map(
      (criterion) => criterion.success_criteria_id,
    )

    setSelectedCriteriaIds((prev) => {
      const next = new Set(prev)
      if (nextChecked) {
        for (const id of criterionIds) {
          next.add(id)
        }
      } else {
        for (const id of criterionIds) {
          next.delete(id)
        }
      }
      return Array.from(next)
    })
  }

  const toggleCriterion = (criterionId: string, nextChecked: boolean) => {
    setSelectedCriteriaIds((prev) => {
      const next = new Set(prev)
      if (nextChecked) {
        next.add(criterionId)
      } else {
        next.delete(criterionId)
      }
      return Array.from(next)
    })
  }

  const handleSave = () => {
    startTransition(async () => {
      try {
        const result = await setLessonSuccessCriteriaAction(
          lesson.lesson_id,
          unitId,
          selectedCriteriaIds,
        )

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        onUpdate(result.data)
        toast.success("Lesson success criteria updated")
        onClose()
      } catch (error) {
        console.error("[lesson-objectives-sidebar] Failed to update lesson success criteria:", error)
        toast.error("Failed to update lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col">
        <Card className="flex h-full flex-col rounded-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Edit Lesson Objectives</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden">
            <p className="text-sm text-muted-foreground">
              Choose the success criteria that apply to{" "}
              <span className="font-medium">{lesson.title}</span>.
            </p>
            <div className="flex-1 space-y-3 overflow-y-auto pr-2">
              {objectiveSelections.length > 0 ? (
                objectiveSelections.map(({ objective, criteria, state }) => {
                  const checkboxState =
                    state === "all" ? true : state === "partial" ? "indeterminate" : false
                  return (
                    <div
                      key={objective.learning_objective_id}
                      className="space-y-3 rounded-md border border-border/60 p-3"
                    >
                      <label className="flex items-start gap-3">
                        <Checkbox
                          checked={checkboxState}
                          onCheckedChange={(value) =>
                            toggleObjective(
                              objective.learning_objective_id,
                              value === true || value === "indeterminate",
                            )
                          }
                          disabled={isPending}
                        />
                        <div className="space-y-1">
                          <div className="font-medium leading-tight">{objective.title}</div>
                          {objective.assessment_objective_title ? (
                            <p className="text-xs text-muted-foreground">
                              {objective.assessment_objective_title}
                            </p>
                          ) : null}
                        </div>
                      </label>
                      {criteria.length > 0 ? (
                        <ul className="space-y-2 border-l pl-3 text-sm text-muted-foreground">
                          {criteria.map((criterion) => {
                            const checked = selectedCriteriaIds.includes(
                              criterion.success_criteria_id,
                            )
                            return (
                              <li key={criterion.success_criteria_id}>
                                <label className="flex items-start gap-3">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) =>
                                      toggleCriterion(
                                        criterion.success_criteria_id,
                                        value === true,
                                      )
                                    }
                                    disabled={isPending}
                                  />
                                  <div className="space-y-1">
                                    <div className="font-medium text-foreground">
                                      {criterion.description}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Level {criterion.level}
                                      {!criterion.active ? (
                                        <span className="ml-2 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-semibold text-destructive">
                                          Inactive
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="pl-7 text-xs text-muted-foreground">
                          No success criteria are defined for this objective yet.
                        </p>
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-muted-foreground">
                  No learning objectives are available for this curriculum.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isPending}>
                Save Objectives
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
