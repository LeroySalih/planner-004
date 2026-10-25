"use client"

import { useEffect, useState, useTransition } from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"

import type { SubUnit } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { LESSON_DESCRIPTION_MAX } from "@/lib/lesson-description"
import {
  createSubUnitAction,
  setSubUnitActiveAction,
  updateSubUnitAction,
} from "@/lib/server-actions/sub-units"

export type SubUnitLessonsChoice = "deactivate" | "ungroup"

interface SubUnitSidebarProps {
  unitId: string
  /** null to create one. */
  subUnit: SubUnit | null
  lessonCount: number
  isOpen: boolean
  onClose: () => void
  onSaved: (subUnit: SubUnit, lessons: SubUnitLessonsChoice | null) => void
}

export function SubUnitSidebar({ unitId, subUnit, lessonCount, isOpen, onClose, onSaved }: SubUnitSidebarProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [active, setActive] = useState(true)
  const [lessonsChoice, setLessonsChoice] = useState<SubUnitLessonsChoice>("ungroup")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!isOpen) return
    setTitle(subUnit?.title ?? "")
    setDescription(subUnit?.description ?? "")
    setActive(subUnit?.active ?? true)
    setLessonsChoice("ungroup")
  }, [isOpen, subUnit])

  if (!isOpen) return null

  const isCreate = subUnit === null
  const switchingOff = !isCreate && subUnit.active && !active
  const lessonsLabel = lessonCount === 1 ? "its lesson" : `its ${lessonCount} lessons`

  const handleSave = () => {
    startTransition(async () => {
      const input = { title, description }
      const saved = isCreate ? await createSubUnitAction(unitId, input) : await updateSubUnitAction(subUnit.sub_unit_id, input)
      if (saved.error || !saved.data) {
        toast.error(saved.error ?? "Unable to save the sub unit.")
        return
      }
      let result = saved.data
      let choice: SubUnitLessonsChoice | null = null
      if (!isCreate && active !== subUnit.active) {
        choice = switchingOff ? lessonsChoice : null
        const toggled = await setSubUnitActiveAction(subUnit.sub_unit_id, active, lessonsChoice)
        if (toggled.error || !toggled.data) {
          toast.error(toggled.error ?? "Unable to change whether the sub unit is active.")
          onSaved(result, null)
          return
        }
        result = toggled.data
      }
      onSaved(result, choice)
      toast.success(isCreate ? "Sub unit added" : "Sub unit saved")
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={isPending ? undefined : onClose} />
      <div className="relative ml-auto w-full max-w-md border-l bg-background shadow-xl">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-xl font-semibold">{isCreate ? "Add Sub Unit" : "Edit Sub Unit"}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={isPending} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="sub-unit-title">Title</Label>
              <Input
                id="sub-unit-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Polymers"
                disabled={isPending}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sub-unit-description">Description</Label>
              <Textarea
                id="sub-unit-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={LESSON_DESCRIPTION_MAX}
                placeholder="Optional. What this part of the unit covers."
                className="min-h-24"
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                {description.trim().length}/{LESSON_DESCRIPTION_MAX}
              </p>
            </div>

            {isCreate ? (
              <p className="text-sm text-muted-foreground">
                Drag lessons onto the sub unit to add them, and drag them out to return them to the unit.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Switch id="sub-unit-active" checked={active} onCheckedChange={setActive} disabled={isPending} />
                  <Label htmlFor="sub-unit-active">Active</Label>
                </div>
                {switchingOff && lessonCount > 0 ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">What should happen to {lessonsLabel}?</p>
                    <RadioGroup
                      value={lessonsChoice}
                      onValueChange={(value) => setLessonsChoice(value as SubUnitLessonsChoice)}
                      disabled={isPending}
                    >
                      <div className="flex items-start gap-2">
                        <RadioGroupItem id="sub-unit-lessons-ungroup" value="ungroup" className="mt-0.5" />
                        <Label htmlFor="sub-unit-lessons-ungroup" className="font-normal">
                          Return them to the unit, still active
                        </Label>
                      </div>
                      <div className="flex items-start gap-2">
                        <RadioGroupItem id="sub-unit-lessons-deactivate" value="deactivate" className="mt-0.5" />
                        <Label htmlFor="sub-unit-lessons-deactivate" className="font-normal">
                          Make them inactive too
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isPending || title.trim().length === 0}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isCreate ? "Add Sub Unit" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
