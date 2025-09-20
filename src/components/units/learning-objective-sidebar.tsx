"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import type { LearningObjectiveWithCriteria, SuccessCriteriaInput } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { X } from "lucide-react"
import {
  createLearningObjectiveAction,
  deleteLearningObjectiveAction,
  updateLearningObjectiveAction,
} from "@/lib/server-updates"

interface LearningObjectiveSidebarProps {
  unitId: string
  learningObjective: LearningObjectiveWithCriteria | null
  isOpen: boolean
  onClose: () => void
  onCreateOrUpdate: (objective: LearningObjectiveWithCriteria) => void
  onDelete: (learningObjectiveId: string) => void
}

const MAX_SUCCESS_CRITERIA = 3

export function LearningObjectiveSidebar({
  unitId,
  learningObjective,
  isOpen,
  onClose,
  onCreateOrUpdate,
  onDelete,
}: LearningObjectiveSidebarProps) {
  const [isPending, startTransition] = useTransition()
  const [title, setTitle] = useState("")
  const [successCriteria, setSuccessCriteria] = useState<Array<{ id?: string; title: string }>>(
    new Array(MAX_SUCCESS_CRITERIA).fill(null).map(() => ({ title: "" })),
  )
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    setTitle(learningObjective?.title ?? "")

    const initialCriteria: Array<{ id?: string; title: string }> = new Array(MAX_SUCCESS_CRITERIA)
      .fill(null)
      .map(() => ({ title: "" }))

    learningObjective?.success_criteria?.forEach((criterion, index) => {
      if (index < MAX_SUCCESS_CRITERIA) {
        initialCriteria[index] = {
          id: criterion.success_criteria_id,
          title: criterion.title,
        }
      }
    })

    setSuccessCriteria(initialCriteria)
    setIsConfirmingDelete(false)
  }, [isOpen, learningObjective])

  if (!isOpen) {
    return null
  }

  const handleSuccessCriterionChange = (index: number, value: string) => {
    setSuccessCriteria((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], title: value }
      return next
    })
  }

  const handleSave = () => {
    if (title.trim().length === 0) {
      toast.error("Learning objective title is required")
      return
    }

    const payload: SuccessCriteriaInput = successCriteria
      .filter((criterion) => criterion.title.trim().length > 0)
      .map((criterion) => ({
        success_criteria_id: criterion.id,
        title: criterion.title,
      }))

    startTransition(async () => {
      try {
        if (learningObjective) {
          const result = await updateLearningObjectiveAction(
            learningObjective.learning_objective_id,
            unitId,
            title.trim(),
            payload,
          )

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Learning objective updated")
        } else {
          const result = await createLearningObjectiveAction(unitId, title.trim(), payload)

          if (result.error || !result.data) {
            throw new Error(result.error ?? "Unknown error")
          }

          onCreateOrUpdate(result.data)
          toast.success("Learning objective created")
        }

        onClose()
      } catch (error) {
        console.error("[v0] Failed to save learning objective:", error)
        toast.error("Failed to save learning objective", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  const handleDelete = () => {
    if (!learningObjective) return

    startTransition(async () => {
      try {
        const result = await deleteLearningObjectiveAction(learningObjective.learning_objective_id, unitId)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        onDelete(learningObjective.learning_objective_id)
        setIsConfirmingDelete(false)
        toast.success("Learning objective deleted")
        onClose()
      } catch (error) {
        console.error("[v0] Failed to delete learning objective:", error)
        toast.error("Failed to delete learning objective", {
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
              {learningObjective ? "Edit Learning Objective" : "Add Learning Objective"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="learning-objective-title">Title</Label>
              <Input
                id="learning-objective-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Describe the learning objective"
                disabled={isPending}
              />
            </div>

            <div className="space-y-3">
              <Label>Success Criteria (up to 3)</Label>
              <div className="space-y-3">
                {successCriteria.map((criterion, index) => (
                  <Textarea
                    key={criterion.id ?? `new-${index}`}
                    value={criterion.title}
                    onChange={(event) => handleSuccessCriterionChange(index, event.target.value)}
                    placeholder={`Success criterion ${index + 1}`}
                    disabled={isPending}
                    rows={3}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button onClick={handleSave} disabled={isPending || title.trim().length === 0}>
                {learningObjective ? "Save Changes" : "Create Learning Objective"}
              </Button>
              {learningObjective && (
              <div className="space-y-3">
                {!isConfirmingDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isPending}
                    onClick={() => setIsConfirmingDelete(true)}
                  >
                    Delete Learning Objective
                  </Button>
                ) : (
                  <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                    <p className="text-destructive">
                      Are you sure? This will remove the learning objective and its success criteria.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={isPending}
                      >
                        Yes, delete
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsConfirmingDelete(false)}
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
