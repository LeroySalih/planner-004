"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { Subjects, Unit } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { X } from "lucide-react"
import { deleteUnitAction, updateUnitAction } from "@/lib/server-updates"

interface UnitEditSidebarProps {
  unit: Unit
  subjects: Subjects
  isOpen: boolean
  onClose: () => void
  onOptimisticUpdate?: (unit: Unit) => void
}

export function UnitEditSidebar({ unit, subjects, isOpen, onClose, onOptimisticUpdate }: UnitEditSidebarProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [formState, setFormState] = useState({
    title: unit.title ?? "",
    subject: unit.subject,
    description: unit.description ?? "",
  })

  useEffect(() => {
    if (!isOpen) return
    setFormState({
      title: unit.title ?? "",
      subject: unit.subject,
      description: unit.description ?? "",
    })
  }, [isOpen, unit])

  const isSaveDisabled =
    isPending || formState.title.trim().length === 0 || formState.subject.trim().length === 0

  const handleSave = () => {
    startTransition(async () => {
      const previousUnit = unit
      const optimisticUnit: Unit = {
        ...unit,
        title: formState.title.trim(),
        subject: formState.subject,
        description: formState.description.trim() || null,
      }

      onOptimisticUpdate?.(optimisticUnit)

      try {
        const result = await updateUnitAction(unit.unit_id, {
          title: formState.title.trim(),
          subject: formState.subject,
          description: formState.description.trim() || null,
        })

        if (result.error || !result.data) {
          throw new Error(result.error ?? "Unknown error")
        }

        if (result.data) {
          onOptimisticUpdate?.(result.data)
        }

        toast.success("Unit updated successfully.")
        router.refresh()
        onClose()
      } catch (error) {
        console.error("[v0] Failed to update unit:", error)
        onOptimisticUpdate?.(previousUnit)
        toast.error("Failed to update unit", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      }
    })
  }

  const handleDeactivate = () => {
    startTransition(async () => {
      const previousUnit = unit
      const optimisticUnit: Unit = { ...unit, active: false }
      onOptimisticUpdate?.(optimisticUnit)

      try {
        const result = await deleteUnitAction(unit.unit_id)

        if (!result.success) {
          throw new Error(result.error ?? "Unknown error")
        }

        onOptimisticUpdate?.(optimisticUnit)

        toast.success("Unit marked as inactive.")
        router.refresh()
        onClose()
      } catch (error) {
        console.error("[v0] Failed to deactivate unit:", error)
        onOptimisticUpdate?.(previousUnit)
        toast.error("Failed to deactivate unit", {
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
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md border-l bg-background shadow-xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">Edit Unit</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="unit-title">Title</Label>
              <Input
                id="unit-title"
                value={formState.title}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Enter unit title"
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-subject">Subject</Label>
              <Select
                value={formState.subject}
                onValueChange={(value) => setFormState((prev) => ({ ...prev, subject: value }))}
                disabled={isPending || subjects.length === 0}
              >
                <SelectTrigger id="unit-subject">
                  <SelectValue placeholder="Choose a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.subject} value={subject.subject}>
                      {subject.subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit-description">Description</Label>
              <Textarea
                id="unit-description"
                value={formState.description}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, description: event.target.value }))
                }
                rows={6}
                placeholder="Describe the unit objectives, scope, or resources..."
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                {unit.active ? "This unit is currently active." : "This unit is currently inactive."}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button onClick={handleSave} disabled={isSaveDisabled}>
                Save Changes
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeactivate}
                disabled={isPending || unit.active === false}
              >
                Mark as Inactive
              </Button>
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
