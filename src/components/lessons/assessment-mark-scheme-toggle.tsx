"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { setAssessmentMarkSchemeVisibilityAction } from "@/lib/server-actions/assessment-paper-settings"

interface AssessmentMarkSchemeToggleProps {
  activityId: string
  initialShow: boolean
  onSaved?: () => void
}

/**
 * Whether each question's mark scheme is in the pupils' feedback PDF. Off for
 * a paper that will be reused with later classes. Saves on change.
 */
export function AssessmentMarkSchemeToggle({ activityId, initialShow, onSaved }: AssessmentMarkSchemeToggleProps) {
  const [show, setShow] = useState(initialShow)
  const [isSaving, setIsSaving] = useState(false)
  const id = `mark-scheme-to-pupils-${activityId}`

  const handleChange = async (next: boolean) => {
    const previous = show
    setShow(next)
    setIsSaving(true)
    try {
      const result = await setAssessmentMarkSchemeVisibilityAction({ activityId, show: next })
      if (result.error) {
        setShow(previous)
        toast.error("Setting not saved", { description: result.error })
        return
      }
      onSaved?.()
    } catch (error) {
      setShow(previous)
      toast.error("Setting not saved", { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <Label htmlFor={id} className="font-medium">
        Include the mark scheme in pupil feedback
      </Label>
      <div className="flex items-center gap-2">
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        <Switch id={id} checked={show} onCheckedChange={(value) => void handleChange(value)} />
      </div>
    </div>
  )
}
