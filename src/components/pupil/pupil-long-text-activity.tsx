"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { saveLongTextAnswerAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface PupilLongTextActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber?: number
  initialAnswer: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  scoreLabel?: string
  feedbackText?: string | null
  modelAnswer?: string | null
}
// ...
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
  scoreLabel = "In progress",
  feedbackText,
  modelAnswer,
}: PupilLongTextActivityProps) {
// ...
// Render inside return

  const canAnswerEffective = canAnswer

  const [answer, setAnswer] = useState(initialAnswer ?? "")
  const [lastSaved, setLastSaved] = useState(initialAnswer ?? "")
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    initialAnswer ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()
  const isSavingRef = useRef(false)

  useEffect(() => {
    console.log(`[PupilLongTextActivity] Mount/Update: ${activity.activity_id}`, { initialAnswer })
    const nextAnswer = initialAnswer ?? ""
    setAnswer(nextAnswer)
    setLastSaved(nextAnswer)
    setFeedback(nextAnswer ? { type: "success", message: "Answer saved" } : null)
  }, [initialAnswer, activity.activity_id])

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
      } finally {
        isSavingRef.current = false
      }
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
    <div className="space-y-3">
      {!canAnswerEffective ? (
        <p className="text-xs text-pa-muted-3">
          You can review this question, but only pupils can enter an answer.
        </p>
      ) : null}

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
      <p className={feedback ? (feedback.type === "success" ? "text-xs font-medium text-pa-green" : "text-xs font-medium text-destructive") : "text-xs text-pa-muted-3"}>
        {helperMessage}
      </p>

      {canAnswerEffective ? (
        <div className="space-y-2">
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="h-auto w-full rounded-[14px] bg-pa-green py-3.5 text-[15px] font-bold text-white hover:bg-pa-green/90"
          >
            {isPending ? "Saving…" : "Save answer"}
          </Button>
          <p className="text-xs text-pa-muted-3">
            You can edit your answer until your teacher marks the work.
          </p>
        </div>
      ) : null}
    </div>
  )
}
