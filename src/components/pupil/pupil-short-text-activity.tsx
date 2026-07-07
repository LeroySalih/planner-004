"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Flag, Loader2, RotateCcw } from "lucide-react"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { saveShortTextAnswerAction, toggleSubmissionFlagAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface PupilShortTextActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber?: number
  initialAnswer: string | null
  initialSubmissionId?: string | null
  initialIsFlagged?: boolean
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
  stepNumber,
  initialAnswer,
  initialSubmissionId,
  initialIsFlagged,
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
  const [submissionId, setSubmissionId] = useState(initialSubmissionId ?? null)
  const [isFlagged, setIsFlagged] = useState(initialIsFlagged ?? false)

  const [feedback, setFeedback] = useState<FeedbackState>(
    initialAnswer ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()
  const [flagPending, startFlagTransition] = useTransition()
  const isSavingRef = useRef(false)

  // Sync from server props when the server re-renders (e.g. manual browser refresh).
  useEffect(() => {
    const nextAnswer = initialAnswer ?? ""
    setAnswer(nextAnswer)
    setLastSaved(nextAnswer)
    setSubmissionId(initialSubmissionId ?? null)
    setIsFlagged(initialIsFlagged ?? false)
    setFeedback(nextAnswer ? { type: "success", message: "Answer saved" } : null)
  }, [initialAnswer, initialSubmissionId, initialIsFlagged, activity.activity_id])

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

        if (result.data) {
          setSubmissionId(result.data.submission_id)
        }

        setLastSaved(answer)
        setFeedback({ type: "success", message: "Answer saved" })
        triggerFeedbackRefresh(lessonId)
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

  const handleToggleFlag = useCallback(() => {
    if (!submissionId) return

    const nextFlag = !isFlagged
    setIsFlagged(nextFlag)

    startFlagTransition(async () => {
      const result = await toggleSubmissionFlagAction({
        submissionId,
        isFlagged: nextFlag,
      })

      if (!result.success) {
        setIsFlagged(!nextFlag)
        toast.error("Unable to update flag status.")
      }
    })
  }, [submissionId, isFlagged])

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
      return "Your teacher will mark this after the lesson. Keep your answer short and precise."
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
        value={answer}
        onChange={(event) => {
          setAnswer(event.target.value)
          setFeedback(null)
        }}
        onBlur={handleBlur}
        placeholder="Type your short answer…"
        disabled={!canAnswerEffective || isPending}
        className="min-h-[96px] w-full resize-none overflow-hidden rounded-pa-box border-[1.5px] border-pa-field-border bg-pa-field px-4 py-3.5 font-[family-name:var(--font-pa-body)] text-[15px] text-pa-ink outline-none placeholder:text-pa-muted-3 focus-visible:border-pa-green disabled:opacity-70"
      />
      <div className={cnFeedback(feedback)}>{helperMessage}</div>

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
      ) : (
        <p className="text-xs text-pa-muted-3">
          You can review this question, but only pupils can enter an answer.
        </p>
      )}

      {submissionId ? (
        <div className="flex flex-col gap-2 border-t border-pa-field-border pt-3 sm:flex-row sm:items-center">
          <Button
            variant={isFlagged ? "destructive" : "outline"}
            size="sm"
            onClick={handleToggleFlag}
            disabled={flagPending}
            className="gap-2 self-start sm:self-auto"
          >
            <Flag className="h-4 w-4" />
            {isFlagged ? "Unflag for review" : "Flag for review"}
          </Button>
          <p className="text-xs text-pa-muted-3">
            {isFlagged
              ? "You have flagged this answer for your teacher to review."
              : "Flag this answer if you want your teacher to check it again."}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function cnFeedback(feedback: FeedbackState): string {
  if (!feedback) {
    return "text-xs text-pa-muted-3"
  }
  if (feedback.type === "success") {
    return "text-xs font-medium text-pa-green"
  }
  return "text-xs font-medium text-destructive"
}
