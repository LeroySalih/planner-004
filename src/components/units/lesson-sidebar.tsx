"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import type { LessonWithObjectives, LearningObjectiveWithCriteria } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { X } from "lucide-react"
import { createLessonAction, deactivateLessonAction, updateLessonAction } from "@/lib/server-updates"

interface LessonSidebarProps {
  unitId: string
  lesson: LessonWithObjectives | null
  isOpen: boolean
  onClose: () => void
  onCreateOrUpdate: (lesson: LessonWithObjectives) => void
  onDeactivate: (lessonId: string) => void
  learningObjectives: LearningObjectiveWithCriteria[]
}

export function LessonSidebar({
  unitId,
  lesson,
  isOpen,
  onClose,
  onCreateOrUpdate,
  onDeactivate,
  learningObjectives,
}: LessonSidebarProps) {
  const [isPending, startTransition] = useTransition()
  const [title, setTitle] = useState("")
  const [isConfirmingDeactivate, setIsConfirmingDeactivate] = useState(false)
  const [selectedObjectiveIds, setSelectedObjectiveIds] = useState<string[]>([])

  const sortedObjectives = [...learningObjectives].sort((a, b) =>
    a.title.localeCompare(b.title),
  )

  useEffect(() => {
    if (!isOpen) return

    setTitle(lesson?.title ?? "")
    setIsConfirmingDeactivate(false)
    const availableIds = new Set(
      learningObjectives.map((objective) => objective.learning_objective_id),
    )
    setSelectedObjectiveIds(
      lesson?.lesson_objectives
        ?.map((entry) => entry.learning_objective_id)
        .filter((id) => availableIds.has(id)) ?? [],
    )
  }, [isOpen, lesson, learningObjectives])

  if (!isOpen) {
    return null
  }

  const isEditing = Boolean(lesson)

  const handleSave = () => {
    if (title.trim().length === 0) {
      toast.error("Lesson title is required")
      return
    }

    startTransition(async () => {
      try {
        if (lesson) {
          const result = await updateLessonAction(
            lesson.lesson_id,
            unitId,
            title.trim(),
            selectedObjectiveIds,
          )

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Lesson updated")
        } else {
          const result = await createLessonAction(unitId, title.trim(), selectedObjectiveIds)

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Lesson created")
        }

        onClose()
      } catch (error) {
        console.error("[v0] Failed to save lesson:", error)
        toast.error("Failed to save lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  const handleDeactivate = () => {
    if (!lesson) return

    startTransition(async () => {
      try {
        const result = await deactivateLessonAction(lesson.lesson_id, unitId)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        onDeactivate(lesson.lesson_id)
        toast.success("Lesson deactivated")
        onClose()
      } catch (error) {
        console.error("[v0] Failed to deactivate lesson:", error)
        toast.error("Failed to deactivate lesson", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
      <div className="relative ml-auto w-full max-w-md border-l bg-background shadow-xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">
              {isEditing ? "Edit Lesson" : "Add Lesson"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="lesson-title">Title</Label>
              <Input
                id="lesson-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Lesson title"
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label>Learning Objectives</Label>
              <div className="space-y-2">
                {sortedObjectives.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No learning objectives available for this unit yet.
                  </p>
                )}
                {sortedObjectives.map((objective) => {
                  const isChecked = selectedObjectiveIds.includes(objective.learning_objective_id)
                  return (
                    <label
                      key={objective.learning_objective_id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          setSelectedObjectiveIds((prev) => {
                            if (checked === true) {
                              if (prev.includes(objective.learning_objective_id)) return prev
                              return [...prev, objective.learning_objective_id]
                            }
                            return prev.filter((id) => id !== objective.learning_objective_id)
                          })
                        }}
                        disabled={isPending}
                      />
                      <span>{objective.title}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button onClick={handleSave} disabled={isPending || title.trim().length === 0}>
                {isEditing ? "Save Changes" : "Create Lesson"}
              </Button>

              {isEditing && lesson?.active !== false && (
                <div className="space-y-3">
                  {!isConfirmingDeactivate ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setIsConfirmingDeactivate(true)}
                      disabled={isPending}
                    >
                      Deactivate Lesson
                    </Button>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                      <p className="text-destructive">
                        Are you sure? Learners will no longer see this lesson.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleDeactivate}
                          disabled={isPending}
                        >
                          Yes, deactivate
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsConfirmingDeactivate(false)}
                          disabled={isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button variant="outline" className="bg-transparent" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
