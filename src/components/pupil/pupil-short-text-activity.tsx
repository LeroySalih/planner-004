"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Flag, Loader2 } from "lucide-react"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  getRichTextMarkup,
  getShortTextBody,
} from "@/components/lessons/activity-view/utils"
import { saveShortTextAnswerAction, toggleSubmissionFlagAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"
import { ActivityProgressPanel } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/activity-progress-panel"

interface PupilShortTextActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber: number
  initialAnswer: string | null
  initialSubmissionId?: string | null
  initialIsFlagged?: boolean
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  scoreLabel?: string
  feedbackText?: string | null
  modelAnswer?: string | null
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
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
  scoreLabel = "In progress",
  feedbackText,
  modelAnswer,
}: PupilShortTextActivityProps) {
  const shortTextBody = useMemo(() => getShortTextBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(shortTextBody.question)
  const { currentVisible } = useFeedbackVisibility()
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

  useEffect(() => {
    console.log(`[PupilShortTextActivity] Mount/Update: ${activity.activity_id}`, { initialAnswer, initialSubmissionId, initialIsFlagged })
    const nextAnswer = initialAnswer ?? ""
    setAnswer(nextAnswer)
    setLastSaved(nextAnswer)
    setSubmissionId(initialSubmissionId ?? null)
    setIsFlagged(initialIsFlagged ?? false)
    setFeedback(nextAnswer ? { type: "success", message: "Answer saved" } : null)
  }, [initialAnswer, initialSubmissionId, initialIsFlagged, activity.activity_id])

  useEffect(() => {
    console.log(`[PupilShortTextActivity] Feedback visibility changed: ${currentVisible}`)
  }, [currentVisible])

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
        {!canAnswerEffective ? (
          <p className="text-xs text-muted-foreground">
            You can review this question, but only pupils can enter an answer.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <Textarea
          ref={textareaRef}
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value)
            setFeedback(null)
          }}
          onBlur={handleBlur}
          placeholder="Type your short answer"
          disabled={!canAnswerEffective || isPending}
          className="resize-none overflow-hidden min-h-[80px]"
        />
        <div
          className={cnFeedback(feedback)}
        >
          {helperMessage}
        </div>
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

      {currentVisible && submissionId ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
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
          <p className="text-xs text-muted-foreground">
            {isFlagged
              ? "You have flagged this answer for your teacher to review."
              : "Flag this answer if you want your teacher to check it again."}
          </p>
        </div>
      ) : null}

      <ActivityProgressPanel
        assignmentIds={feedbackAssignmentIds}
        lessonId={lessonId}
        initialVisible={feedbackInitiallyVisible}
        show={true}
        scoreLabel={scoreLabel}
        feedbackText={feedbackText}
        modelAnswer={modelAnswer}
      />
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
