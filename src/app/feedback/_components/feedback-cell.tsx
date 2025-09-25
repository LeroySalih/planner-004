"use client"

import { useState, useTransition } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { upsertFeedbackAction } from "@/lib/server-updates"

type FeedbackState = "up" | "down" | null

type FeedbackCellProps = {
  pupilId: string
  pupilName: string
  criterionId: string
  criterionDescription: string
  lessonId: string
  initialRating: 1 | -1 | null
}

export function FeedbackCell({
  pupilId,
  pupilName,
  criterionId,
  criterionDescription,
  lessonId,
  initialRating,
}: FeedbackCellProps) {
  const [state, setState] = useState<FeedbackState>(() => {
    if (initialRating === 1) return "up"
    if (initialRating === -1) return "down"
    return null
  })
  const [isPending, startTransition] = useTransition()

  const handleThumbsUp = () => {
    const prev = state
    const next = prev === "up" ? null : "up"

    if (prev === next) return

    setState(next)
    const rating = next === "up" ? 1 : next === "down" ? -1 : null
    startTransition(async () => {
      const result = await upsertFeedbackAction({
        userId: pupilId,
        lessonId,
        successCriteriaId: criterionId,
        rating,
      })

      if (!result.success) {
        console.error("[feedback] Failed to store feedback", result.error)
        setState(prev)
      }
    })
  }

  const handleThumbsDown = () => {
    const prev = state
    const next = prev === "down" ? null : "down"

    if (prev === next) return

    setState(next)
    const rating = next === "up" ? 1 : next === "down" ? -1 : null
    startTransition(async () => {
      const result = await upsertFeedbackAction({
        userId: pupilId,
        lessonId,
        successCriteriaId: criterionId,
        rating,
      })

      if (!result.success) {
        console.error("[feedback] Failed to store feedback", result.error)
        setState(prev)
      }
    })
  }

  return (
    <td
      className={cn(
        "px-4 py-3 border border-border text-center transition-colors",
        state === "up" && "bg-emerald-50 border-emerald-200",
        state === "down" && "bg-destructive/10 border-destructive/50",
      )}
      data-pupil-id={pupilId}
      data-criterion-id={criterionId}
      data-loading={isPending ? "true" : undefined}
    >
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleThumbsUp}
          aria-pressed={state === "up"}
          aria-label={`Thumbs up for ${pupilName} on ${criterionDescription}`}
          disabled={isPending}
          className={cn(
            "rounded-full border border-border/60 bg-muted/60 p-2 text-emerald-600 transition hover:border-emerald-200 hover:bg-emerald-50",
            state === "up" && "border-emerald-400 bg-emerald-100",
            isPending && "opacity-70",
          )}
        >
          <ThumbsUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleThumbsDown}
          aria-pressed={state === "down"}
          aria-label={`Thumbs down for ${pupilName} on ${criterionDescription}`}
          disabled={isPending}
          className={cn(
            "rounded-full border border-border/60 bg-muted/60 p-2 text-destructive transition hover:border-destructive/50 hover:bg-destructive/10",
            state === "down" && "border-destructive bg-destructive/20 text-destructive",
            isPending && "opacity-70",
          )}
        >
          <ThumbsDown className="h-4 w-4" />
        </button>
      </div>
    </td>
  )
}
