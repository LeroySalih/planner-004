"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { getLongTextBody, getRichTextMarkup } from "@/components/lessons/activity-view/utils"
import { saveLongTextAnswerAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"

interface PupilLongTextActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber: number
  initialAnswer: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
}

type FeedbackState = { type: "success" | "error"; message: string } | null

export function PupilLongTextActivity({
  lessonId,
  activity,
  pupilId,
  canAnswer,
  stepNumber,
  initialAnswer,
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
}: PupilLongTextActivityProps) {
  const longTextBody = useMemo(() => getLongTextBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(longTextBody.question)
  const { currentVisible } = useFeedbackVisibility({
    assignmentIds: feedbackAssignmentIds,
    lessonId: feedbackLessonId ?? lessonId,
    initialVisible: feedbackInitiallyVisible,
  })
  const canAnswerEffective = canAnswer && !currentVisible

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
    if (!canAnswerEffective) {
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
      const result = await saveLongTextAnswerAction({
        activityId: activity.activity_id,
        userId: pupilId,
        answer,
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
  }, [activity.activity_id, answer, canAnswerEffective, lastSaved, lessonId, pupilId, startTransition])

  const helperMessage = useMemo(() => {
    if (!canAnswerEffective) {
      return "You can view this question, but answers can only be edited by pupils."
    }
    if (!feedback) {
      return "Write your response in as much detail as needed."
    }
    return feedback.type === "success" ? feedback.message : feedback.message
  }, [canAnswerEffective, feedback])

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {stepNumber}
        </span>
        <h4 className="text-lg font-semibold text-foreground">
          {activity.title || "Long text question"}
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
            {longTextBody.question?.trim() || "Your teacher will add the question soon."}
          </p>
        )}
        {!canAnswerEffective ? (
          <p className="text-xs text-muted-foreground">
            You can review this question, but only pupils can enter an answer.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <RichTextEditor
          id={`long-text-answer-${activity.activity_id}`}
          value={answer}
          onChange={(value) => {
            setAnswer(value)
            setFeedback(null)
          }}
          placeholder="Type your response here"
          disabled={!canAnswerEffective || isPending}
        />
        <p className={feedback ? (feedback.type === "success" ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-destructive") : "text-xs text-muted-foreground"}>
          {helperMessage}
        </p>
      </section>

      {canAnswerEffective ? (
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
