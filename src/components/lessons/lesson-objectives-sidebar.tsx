"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { X } from "lucide-react"

import type { LearningObjectiveWithCriteria, LessonWithObjectives } from "@/lib/server-updates"
import { updateLessonAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"

interface LessonObjectivesSidebarProps {
  unitId: string
  lesson: LessonWithObjectives
  learningObjectives: LearningObjectiveWithCriteria[]
  isOpen: boolean
  onClose: () => void
  onUpdate: (lesson: LessonWithObjectives) => void
}

export function LessonObjectivesSidebar({
  unitId,
  lesson,
  learningObjectives,
  isOpen,
  onClose,
  onUpdate,
}: LessonObjectivesSidebarProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    lesson.lesson_objectives.map((objective) => objective.learning_objective_id),
  )
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setSelectedIds(lesson.lesson_objectives.map((objective) => objective.learning_objective_id))
  }, [lesson.lesson_objectives])

  if (!isOpen) {
    return null
  }

  const handleToggle = (learningObjectiveId: string, checked: boolean | "indeterminate") => {
    setSelectedIds((prev) => {
      if (checked === true) {
        if (prev.includes(learningObjectiveId)) return prev
        return [...prev, learningObjectiveId]
      }
      return prev.filter((id) => id !== learningObjectiveId)
    })
  }

  const handleSave = () => {
    startTransition(async () => {
      try {
        const result = await updateLessonAction(lesson.lesson_id, unitId, lesson.title, selectedIds)

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        onUpdate(result.data)
        toast.success("Lesson objectives updated")
        onClose()
      } catch (error) {
        console.error("[v0] Failed to update lesson objectives:", error)
        toast.error("Failed to update lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
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
              Select the learning objectives that apply to <span className="font-medium">{lesson.title}</span>.
            </p>
            <div className="flex-1 space-y-3 overflow-y-auto pr-2">
              {learningObjectives.length > 0 ? (
                learningObjectives.map((objective) => {
                  const checked = selectedIds.includes(objective.learning_objective_id)
                  return (
                    <label
                      key={objective.learning_objective_id}
                      className="flex items-start gap-3 rounded-md border border-border/60 p-3 text-sm hover:border-primary"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => handleToggle(objective.learning_objective_id, value)}
                        disabled={isPending}
                      />
                      <div className="space-y-1">
                        <div className="font-medium leading-tight">{objective.title}</div>
                        {objective.success_criteria && objective.success_criteria.length > 0 && (
                          <ul className="space-y-1 text-xs text-muted-foreground">
                            {objective.success_criteria.map((criterion) => (
                              <li key={criterion.success_criteria_id} className="list-disc pl-4 marker:text-primary">
                                {criterion.title}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </label>
                  )
                })
              ) : (
                <p className="text-sm text-muted-foreground">No learning objectives are available for this unit.</p>
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
