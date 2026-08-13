"use client"

import { useState, useTransition } from "react"
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  countActivitiesUsingCriterionAction,
  setSuccessCriterionDescriptorsAction,
  updateSuccessCriterionTypeAction,
} from "@/lib/server-updates"

export type ScType = "binary" | "levelled"

interface CriterionTypeEditorProps {
  criterionId: string
  curriculumId: string
  scType: ScType
  descriptors: string[]
  onChange: (next: { scType: ScType; descriptors: string[] }) => void
  onToast: (variant: "success" | "error", message: string) => void
}

/**
 * Binary/levelled toggle plus the ordered descriptor list for a success
 * criterion.
 *
 * A criterion's type is intrinsic, so every edit here changes max_marks on
 * every activity using the criterion. Switching levelled -> binary additionally
 * deletes the descriptors, so that direction confirms first and names how many
 * activities are affected.
 */
export function CriterionTypeEditor({
  criterionId,
  curriculumId,
  scType,
  descriptors,
  onChange,
  onToast,
}: CriterionTypeEditorProps) {
  const [isPending, startTransition] = useTransition()
  const [draft, setDraft] = useState<string[]>(descriptors)
  const [confirmBinary, setConfirmBinary] = useState<{ open: boolean; activityCount: number }>({
    open: false,
    activityCount: 0,
  })

  const availableMarks = scType === "levelled" ? Math.max(1, descriptors.length) : 1

  const persistDescriptors = (next: string[]) => {
    const cleaned = next.map((d) => d.trim()).filter((d) => d.length > 0)
    if (cleaned.length === 0) {
      onToast("error", "A levelled criterion needs at least one descriptor.")
      return
    }

    startTransition(async () => {
      const result = await setSuccessCriterionDescriptorsAction(criterionId, curriculumId, cleaned)
      if (result.error) {
        onToast("error", result.error)
        return
      }
      onChange({ scType: "levelled", descriptors: cleaned })
      const affected = result.data?.affected_activities ?? 0
      onToast(
        "success",
        affected > 0
          ? `Descriptors saved. Max marks updated on ${affected} ${affected === 1 ? "activity" : "activities"}.`
          : "Descriptors saved.",
      )
    })
  }

  const switchToLevelled = () => {
    // Seed with a single rung so the criterion is immediately valid; the
    // teacher adds the rest.
    persistDescriptors(draft.length > 0 ? draft : ["Meets the criterion"])
  }

  const requestBinary = () => {
    startTransition(async () => {
      const result = await countActivitiesUsingCriterionAction(criterionId)
      setConfirmBinary({ open: true, activityCount: result.data?.count ?? 0 })
    })
  }

  const confirmSwitchToBinary = () => {
    setConfirmBinary({ open: false, activityCount: 0 })
    startTransition(async () => {
      const result = await updateSuccessCriterionTypeAction(criterionId, curriculumId, "binary")
      if (result.error) {
        onToast("error", result.error)
        return
      }
      setDraft([])
      onChange({ scType: "binary", descriptors: [] })
      const affected = result.data?.affected_activities ?? 0
      onToast(
        "success",
        affected > 0
          ? `Now scored 0 or 1. Max marks updated on ${affected} ${affected === 1 ? "activity" : "activities"}.`
          : "Now scored 0 or 1.",
      )
    })
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.length) return
    const next = [...draft]
    ;[next[index], next[target]] = [next[target], next[index]]
    setDraft(next)
    persistDescriptors(next)
  }

  const remove = (index: number) => {
    if (draft.length <= 1) {
      onToast("error", "A levelled criterion needs at least one descriptor.")
      return
    }
    const next = draft.filter((_, i) => i !== index)
    setDraft(next)
    persistDescriptors(next)
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/60 p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground">Scoring</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          <button
            type="button"
            disabled={isPending}
            onClick={() => (scType === "levelled" ? requestBinary() : undefined)}
            className={`px-2 py-1 text-xs transition ${
              scType === "binary"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            Binary
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => (scType === "binary" ? switchToLevelled() : undefined)}
            className={`px-2 py-1 text-xs transition ${
              scType === "levelled"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            Levelled
          </button>
        </div>
        <span className="text-muted-foreground">
          {scType === "binary"
            ? "0 or 1 — worth 1 mark"
            : `0 to ${availableMarks} — worth ${availableMarks} ${availableMarks === 1 ? "mark" : "marks"}`}
        </span>
      </div>

      {scType === "levelled" ? (
        <ol className="space-y-1">
          {draft.map((descriptor, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="mt-2 w-4 shrink-0 text-right text-xs font-semibold text-muted-foreground">
                {index + 1}
              </span>
              <textarea
                value={descriptor}
                disabled={isPending}
                onChange={(event) => {
                  const next = [...draft]
                  next[index] = event.target.value
                  setDraft(next)
                }}
                onBlur={() => {
                  if (draft[index].trim() !== descriptors[index]) {
                    persistDescriptors(draft)
                  }
                }}
                rows={1}
                className="min-h-[34px] flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  disabled={isPending || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="Move descriptor up"
                  className="rounded border border-border p-1 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={isPending || index === draft.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="Move descriptor down"
                  className="rounded border border-border p-1 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => remove(index)}
                  aria-label="Remove descriptor"
                  className="rounded border border-destructive/50 p-1 text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </li>
          ))}
          <li>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                const next = [...draft, ""]
                setDraft(next)
              }}
              className="ml-6 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
              Add level
            </button>
          </li>
        </ol>
      ) : null}

      <AlertDialog
        open={confirmBinary.open}
        onOpenChange={(open) => setConfirmBinary((prev) => ({ ...prev, open }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to binary scoring?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes all {descriptors.length} descriptors on this criterion and scores it 0
              or 1 instead.
              {confirmBinary.activityCount > 0 ? (
                <>
                  {" "}
                  The criterion is used by {confirmBinary.activityCount}{" "}
                  {confirmBinary.activityCount === 1 ? "activity" : "activities"}, and their max
                  marks will change.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitchToBinary}>Switch to binary</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
