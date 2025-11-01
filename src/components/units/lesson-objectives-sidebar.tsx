"use client"

import { useEffect, useState, useTransition } from "react"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import { updateLessonAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"

interface LessonObjectivesSidebarProps {
  unitId: string
  lesson: LessonWithObjectives | null
  availableObjectives: LearningObjectiveWithCriteria[]
  isOpen: boolean
  onClose: () => void
  onUpdate: (lesson: LessonWithObjectives) => void
}

export function LessonObjectivesSidebar({
  unitId,
  lesson,
  availableObjectives,
  isOpen,
  onClose,
  onUpdate,
}: LessonObjectivesSidebarProps) {
  const [isPending, startTransition] = useTransition()
  const [selectedObjectiveIds, setSelectedObjectiveIds] = useState<string[]>([])

  useEffect(() => {
    if (!isOpen || !lesson) {
      setSelectedObjectiveIds([])
      return
    }

    const availableIds = new Set(availableObjectives.map((objective) => objective.learning_objective_id))
    setSelectedObjectiveIds(
      (lesson.lesson_objectives ?? [])
        .map((objective) => objective.learning_objective_id)
        .filter((id) => availableIds.has(id)),
    )
  }, [isOpen, lesson, availableObjectives])

  const handleToggleObjective = (objectiveId: string, checked: boolean | "indeterminate") => {
    setSelectedObjectiveIds((prev) => {
      if (checked === true) {
        if (prev.includes(objectiveId)) {
          return prev
        }
        return [...prev, objectiveId]
      }
      return prev.filter((id) => id !== objectiveId)
    })
  }

  const handleSave = () => {
    if (!lesson) return

    startTransition(async () => {
      const result = await updateLessonAction(lesson.lesson_id, unitId, lesson.title, selectedObjectiveIds)

      if (!result.data || result.error) {
        toast.error("Failed to update objectives", {
          description: result.error ?? "Please try again later.",
        })
        return
      }

      toast.success("Learning objectives updated")
      onUpdate(result.data)
      onClose()
    })
  }

  if (!isOpen || !lesson) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
      <div className="relative ml-auto w-full max-w-md border-l bg-background shadow-xl">
        <Card className="flex h-full flex-col rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Lesson objectives</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending} aria-label="Close">
              ×
            </Button>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-6 overflow-hidden px-6 pb-6 pt-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Lesson</p>
              <p className="text-base font-medium text-foreground">{lesson.title}</p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {availableObjectives.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This unit does not have any learning objectives yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {availableObjectives.map((objective) => {
                    const isChecked = selectedObjectiveIds.includes(objective.learning_objective_id)
                    const label = objective.title
                    const specRef = objective.spec_ref?.trim() ?? ""
                    return (
                      <li key={objective.learning_objective_id}>
                        <label className="flex items-start gap-3 text-sm">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) => handleToggleObjective(objective.learning_objective_id, checked)}
                            disabled={isPending}
                          />
                          <span className="leading-tight text-foreground">
                            {label}
                            {specRef.length > 0 ? (
                              <span className="block text-xs text-muted-foreground">Spec reference: {specRef}</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={handleSave} disabled={isPending}>
                {isPending ? "Saving…" : "Save objectives"}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={isPending} className="bg-transparent">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
