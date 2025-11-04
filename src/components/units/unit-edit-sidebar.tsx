"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { X } from "lucide-react"

import type { Subjects, Unit } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  UNIT_MUTATION_INITIAL_STATE,
  triggerUnitDeactivateJobAction,
  triggerUnitUpdateJobAction,
} from "@/lib/server-updates"

interface UnitEditSidebarProps {
  unit: Unit
  subjects: Subjects
  isOpen: boolean
  onClose: () => void
  onOptimisticUpdate?: (unit: Unit) => void
  onJobQueued?: (jobId: string) => void
}

export function UnitEditSidebar({
  unit,
  subjects,
  isOpen,
  onClose,
  onOptimisticUpdate,
  onJobQueued,
}: UnitEditSidebarProps) {
  const [formState, setFormState] = useState({
    title: unit.title ?? "",
    subject: unit.subject,
    description: unit.description ?? "",
    year: unit.year?.toString() ?? "",
  })
  const previousUnitRef = useRef<Unit | null>(null)
  const lastUpdateJobIdRef = useRef<string | null>(null)
  const lastDeactivateJobIdRef = useRef<string | null>(null)
  const expectUpdateResponseRef = useRef(false)
  const expectDeactivateResponseRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const onOptimisticUpdateRef = useRef(onOptimisticUpdate)
  const onJobQueuedRef = useRef(onJobQueued)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    onOptimisticUpdateRef.current = onOptimisticUpdate
  }, [onOptimisticUpdate])

  useEffect(() => {
    onJobQueuedRef.current = onJobQueued
  }, [onJobQueued])

  const [updateState, triggerUpdateUnit, updatePending] = useActionState(
    triggerUnitUpdateJobAction,
    UNIT_MUTATION_INITIAL_STATE,
  )
  const [deactivateState, triggerDeactivateUnit, deactivatePending] = useActionState(
    triggerUnitDeactivateJobAction,
    UNIT_MUTATION_INITIAL_STATE,
  )
  const [pendingTransition, startTransition] = useTransition()

  useEffect(() => {
    if (!isOpen) return
    setFormState({
      title: unit.title ?? "",
      subject: unit.subject,
      description: unit.description ?? "",
      year: unit.year?.toString() ?? "",
    })
  }, [isOpen, unit])

  useEffect(() => {
    if (updateState.status === "queued" && updateState.jobId) {
      if (!expectUpdateResponseRef.current || lastUpdateJobIdRef.current === updateState.jobId) {
        return
      }

      expectUpdateResponseRef.current = false
      lastUpdateJobIdRef.current = updateState.jobId
     toast.info("Unit update queued", {
        description: "We will let you know once the changes are applied.",
      })
      onJobQueuedRef.current?.(updateState.jobId)
      previousUnitRef.current = null
      onCloseRef.current()
    } else if (updateState.status === "error" && updateState.message) {
      if (!expectUpdateResponseRef.current) {
        return
      }

      expectUpdateResponseRef.current = false
      toast.error(updateState.message)
      if (previousUnitRef.current) {
        onOptimisticUpdateRef.current?.(previousUnitRef.current)
        previousUnitRef.current = null
      }
      lastUpdateJobIdRef.current = null
    }
  }, [updateState])

  useEffect(() => {
    if (deactivateState.status === "queued" && deactivateState.jobId) {
      if (!expectDeactivateResponseRef.current || lastDeactivateJobIdRef.current === deactivateState.jobId) {
        return
      }

      expectDeactivateResponseRef.current = false
      lastDeactivateJobIdRef.current = deactivateState.jobId
      toast.info("Unit deactivation queued", {
        description: "The unit will be marked inactive shortly.",
      })
      onJobQueuedRef.current?.(deactivateState.jobId)
      previousUnitRef.current = null
      onCloseRef.current()
    } else if (deactivateState.status === "error" && deactivateState.message) {
      if (!expectDeactivateResponseRef.current) {
        return
      }

      expectDeactivateResponseRef.current = false
      toast.error(deactivateState.message)
      if (previousUnitRef.current) {
        onOptimisticUpdateRef.current?.(previousUnitRef.current)
        previousUnitRef.current = null
      }
      lastDeactivateJobIdRef.current = null
    }
  }, [deactivateState])

  const isPending = updatePending || deactivatePending || pendingTransition
  const isSaveDisabled =
    isPending || formState.title.trim().length === 0 || formState.subject.trim().length === 0

  const handleSave = () => {
    if (updatePending) return

    const trimmedYear = formState.year.trim()
    const parsedYear = trimmedYear.length === 0 ? null : Number.parseInt(trimmedYear, 10)
    if (parsedYear !== null && (!Number.isFinite(parsedYear) || parsedYear < 1 || parsedYear > 13)) {
      toast.error("Year must be between 1 and 13")
      return
    }

    const optimisticUnit: Unit = {
      ...unit,
      title: formState.title.trim(),
      subject: formState.subject,
      description: formState.description.trim() || null,
      year: parsedYear,
    }

    previousUnitRef.current = unit
    onOptimisticUpdate?.(optimisticUnit)

    const formData = new FormData()
    formData.set("unitId", unit.unit_id)
    formData.set("title", formState.title)
    formData.set("subject", formState.subject)
    formData.set("description", formState.description)
    formData.set("year", formState.year)

    expectUpdateResponseRef.current = true
    startTransition(() => {
      triggerUpdateUnit(formData)
    })
  }

  const handleDeactivate = () => {
    if (deactivatePending) return

    const optimisticUnit: Unit = { ...unit, active: false }
    previousUnitRef.current = unit
    onOptimisticUpdate?.(optimisticUnit)

    const formData = new FormData()
    formData.set("unitId", unit.unit_id)
    expectDeactivateResponseRef.current = true
    startTransition(() => {
      triggerDeactivateUnit(formData)
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
              <Label htmlFor="unit-year">Year (optional)</Label>
              <Input
                id="unit-year"
                type="number"
                min={1}
                max={13}
                value={formState.year}
                onChange={(event) => setFormState((prev) => ({ ...prev, year: event.target.value }))}
                placeholder="e.g. 7"
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
