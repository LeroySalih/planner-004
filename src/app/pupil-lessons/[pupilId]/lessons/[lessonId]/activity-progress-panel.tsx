"use client"

import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { useFeedbackVisibility } from "./feedback-visibility-debug"

type ActivityProgressPanelProps = {
  assignmentIds: string[]
  lessonId: string
  initialVisible: boolean
  show: boolean
  scoreLabel: string
  feedbackText: string | null | undefined
  modelAnswer: string | null | undefined
  lockedMessage?: string
}

export function ActivityProgressPanel({
  assignmentIds,
  lessonId,
  initialVisible,
  show,
  scoreLabel,
  feedbackText,
  modelAnswer,
  lockedMessage = "Your score, feedback, and the model answer will appear once your teacher makes them visible.",
}: ActivityProgressPanelProps) {
  const { currentVisible } = useFeedbackVisibility({ assignmentIds, lessonId, initialVisible })

  if (!show) {
    return null
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-background/80 p-4 text-sm shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/5 text-[11px] font-semibold uppercase tracking-wide text-primary"
          >
            Your progress
          </Badge>
          <span className="text-xs text-muted-foreground">
            {currentVisible ? "Feedback released" : "Waiting for your teacher to release feedback"}
          </span>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {currentVisible ? scoreLabel : "Locked"}
        </span>
      </div>

      {currentVisible ? (
        <dl className="mt-3 space-y-3">
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feedback</dt>
            <dd className="mt-1 text-sm text-foreground">{feedbackText || "No feedback yet."}</dd>
          </div>
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model answer</dt>
            <dd className="mt-1 text-sm text-foreground">
              {modelAnswer || "Your teacher hasn’t shared a model answer yet."}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{lockedMessage}</p>
      )}
    </div>
  )
}
