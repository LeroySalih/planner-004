"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2, RotateCcw } from "lucide-react"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { saveShortTextAnswerAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface PupilShortTextActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  /** id for the answer field, so the question can be its <label>. */
  inputId?: string
  stepNumber?: number
  initialAnswer: string | null
  initialResubmitRequested?: boolean
  resubmitNote?: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  scoreLabel?: string
  feedbackText?: string | null
  modelAnswer?: string | null
  initialIsPendingMarking?: boolean
  submissionCount?: number
}

type FeedbackState = { type: "success" | "error"; message: string } | null

export function PupilShortTextActivity({
  lessonId,
  activity,
  pupilId,
  canAnswer,
  inputId,
  stepNumber,
  initialAnswer,
  initialResubmitRequested,
  resubmitNote,
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
  scoreLabel: scoreLabelProp = "In progress",
  feedbackText: feedbackTextProp,
  modelAnswer,
  initialIsPendingMarking = false,
  submissionCount,
}: PupilShortTextActivityProps) {
  const canAnswerEffective = canAnswer

  const [answer, setAnswer] = useState(initialAnswer ?? "")
  const [lastSaved, setLastSaved] = useState(initialAnswer ?? "")

  const [feedback, setFeedback] = useState<FeedbackState>(
    initialAnswer ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()
  const isSavingRef = useRef(false)

  // Sync from server props when the server re-renders (e.g. manual browser refresh).
  useEffect(() => {
    const nextAnswer = initialAnswer ?? ""
    setAnswer(nextAnswer)
    setLastSaved(nextAnswer)
    setFeedback(nextAnswer ? { type: "success", message: "Answer saved" } : null)
  }, [initialAnswer, activity.activity_id])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [answer, adjustHeight])

  const handleSave = useCallback(() => {
    if (!canAnswerEffective || isSavingRef.current) {
      return
    }

    const trimmedAnswer = answer.trim()
    const trimmedLastSaved = lastSaved.trim()

    if (trimmedAnswer === trimmedLastSaved) {
      setFeedback(trimmedAnswer ? { type: "success", message: "Answer saved" } : null)
      return
    }

    setFeedback(null)
    isSavingRef.current = true

    startTransition(async () => {
      try {
        const assignmentId = feedbackAssignmentIds && feedbackAssignmentIds.length > 0
          ? feedbackAssignmentIds[0]
          : undefined

        const result = await saveShortTextAnswerAction({
          activityId: activity.activity_id,
          userId: pupilId,
          answer: answer,
          assignmentId,
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
        triggerFeedbackRefresh(lessonId, activity.activity_id)
      } finally {
        isSavingRef.current = false
      }
    })
  }, [activity.activity_id, answer, canAnswerEffective, lastSaved, lessonId, pupilId, startTransition, feedbackAssignmentIds])

  const handleBlur = useCallback(() => {
    if (!isPending && !isSavingRef.current) {
      handleSave()
    }
  }, [handleSave, isPending])

  const helperMessage = useMemo(() => {
    if (!canAnswerEffective) {
      return "You can view this question, but answers can only be edited by pupils."
    }
    if (isPending) {
      return (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </span>
      )
    }
    if (!feedback) {
      return null
    }
    return feedback.type === "success" ? feedback.message : feedback.message
  }, [canAnswerEffective, feedback, isPending])

  return (
    <div className="space-y-3">
      {initialResubmitRequested && (
        <div className="flex items-start gap-3 rounded-pa-box border border-pa-amber-tint bg-pa-amber-tint px-4 py-3 text-pa-amber">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">Resubmission requested</p>
            {resubmitNote && <p className="text-sm opacity-90">{resubmitNote}</p>}
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        id={inputId}
        rows={1}
        value={answer}
        onChange={(event) => {
          setAnswer(event.target.value)
          setFeedback(null)
        }}
        onBlur={handleBlur}
        placeholder="Type your answer"
        disabled={!canAnswerEffective || isPending}
        className="block min-h-12 w-full resize-none overflow-hidden rounded-[10px] border border-pa-field-border bg-pa-field px-4 py-3 text-[16px] leading-6 text-pa-ink outline-none placeholder:text-pa-muted-3 focus-visible:border-pa-green focus-visible:ring-2 focus-visible:ring-pa-green/25 disabled:opacity-70"
      />

      {canAnswerEffective ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="min-h-11 rounded-lg bg-pa-green px-5 text-[15px] font-semibold text-white hover:bg-pa-green/90"
          >
            {isPending ? "Saving…" : "Save answer"}
          </Button>
          <p role="status" className={cnFeedback(feedback)}>
            {helperMessage}
          </p>
        </div>
      ) : (
        <p className="text-sm text-pa-muted-3">
          You can review this question, but only pupils can enter an answer.
        </p>
      )}

    </div>
  )
}

function cnFeedback(feedback: FeedbackState): string {
  if (!feedback) {
    return "text-sm text-pa-muted-3"
  }
  if (feedback.type === "success") {
    return "text-sm font-medium text-pa-green"
  }
  return "text-sm font-medium text-destructive"
}
