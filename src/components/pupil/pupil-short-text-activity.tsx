"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getRichTextMarkup,
  getShortTextBody,
} from "@/components/lessons/activity-view/utils"
import { saveShortTextAnswerAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface PupilShortTextActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber: number
  initialAnswer: string | null
}

type FeedbackState = { type: "success" | "error"; message: string } | null

export function PupilShortTextActivity({
  lessonId,
  activity,
  pupilId,
  canAnswer,
  stepNumber,
  initialAnswer,
}: PupilShortTextActivityProps) {
  const shortTextBody = useMemo(() => getShortTextBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(shortTextBody.question)

  const [answer, setAnswer] = useState(initialAnswer ?? "")
  const [lastSaved, setLastSaved] = useState(initialAnswer ?? "")
  const [feedback, setFeedback] = useState<FeedbackState>(
    initialAnswer ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const nextAnswer = initialAnswer ?? ""
    setAnswer(nextAnswer)
    setLastSaved(nextAnswer)
    setFeedback(nextAnswer ? { type: "success", message: "Answer saved" } : null)
  }, [initialAnswer])

  const handleSave = useCallback(() => {
    if (!canAnswer) {
      return
    }

    const trimmedAnswer = answer.trim()
    const trimmedLastSaved = lastSaved.trim()

    if (trimmedAnswer === trimmedLastSaved) {
      setFeedback(trimmedAnswer ? { type: "success", message: "Answer saved" } : null)
      return
    }

    setFeedback(null)

    startTransition(async () => {
      const result = await saveShortTextAnswerAction({
        activityId: activity.activity_id,
        userId: pupilId,
        answer: answer,
      })

      if (!result.success) {
        toast.error("Unable to save your answer", {
          description: result.error ?? "Please try again in a moment.",
        })
        setFeedback({
          type: "error",
          message: result.error ?? "Unable to save your answer. Please try again.",
        })
        return
      }

      setLastSaved(answer)
      setFeedback({ type: "success", message: "Answer saved" })
      triggerFeedbackRefresh(lessonId)
    })
  }, [activity.activity_id, answer, canAnswer, lastSaved, lessonId, pupilId, startTransition])

  const handleBlur = useCallback(() => {
    if (!isPending) {
      handleSave()
    }
  }, [handleSave, isPending])

  const helperMessage = useMemo(() => {
    if (!canAnswer) {
      return "You can view this question, but answers can only be edited by pupils."
    }
    if (!feedback) {
      return "Your teacher will mark this after the lesson. Keep your answer short and precise."
    }
    return feedback.type === "success" ? feedback.message : feedback.message
  }, [canAnswer, feedback])

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {stepNumber}
        </span>
        <h4 className="text-lg font-semibold text-foreground">
          {activity.title || "Short text question"}
        </h4>
      </header>

      <section className="space-y-2">
        {questionMarkup ? (
          <div
            className="prose prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: questionMarkup }}
          />
        ) : (
          <p className="text-base text-foreground">
            {shortTextBody.question?.trim() || "Your teacher will add the question soon."}
          </p>
        )}
        {!canAnswer ? (
          <p className="text-xs text-muted-foreground">
            You can review this question, but only pupils can enter an answer.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <Input
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value)
            setFeedback(null)
          }}
          onBlur={handleBlur}
          placeholder="Type your short answer"
          disabled={!canAnswer || isPending}
        />
        <div
          className={cnFeedback(feedback)}
        >
          {helperMessage}
        </div>
      </section>

      {canAnswer ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save answer"}
          </Button>
          <p className="text-xs text-muted-foreground">
            You can edit your answer until your teacher marks the work.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function cnFeedback(feedback: FeedbackState): string {
  if (!feedback) {
    return "text-xs text-muted-foreground"
  }
  if (feedback.type === "success") {
    return "text-xs font-medium text-emerald-600"
  }
  return "text-xs font-medium text-destructive"
}
