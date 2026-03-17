"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Flag, Loader2, RotateCcw } from "lucide-react"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  getRichTextMarkup,
  getShortTextBody,
} from "@/components/lessons/activity-view/utils"
import { saveShortTextAnswerAction, toggleSubmissionFlagAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { ActivityProgressPanel } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/activity-progress-panel"
import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"

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
}: PupilShortTextActivityProps) {
  const shortTextBody = useMemo(() => getShortTextBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(shortTextBody.question)
  const canAnswerEffective = canAnswer

  // Read live marking results from the page-level SSE context.
  // When n8n marks this activity, FeedbackVisibilityProvider stores the result here
  // and the component re-renders with the new score/feedback — no router.refresh() needed.
  const { markingResults } = useFeedbackVisibility()
  const contextResult = markingResults.get(activity.activity_id)

  // Merge server-initial props with live context result.
  // Context result wins when present (it's fresher than the server render).
  const effectiveScoreLabel = contextResult
    ? (contextResult.score !== null ? `${Math.round(contextResult.score * 100)}%` : "—")
    : scoreLabelProp
  const effectiveFeedbackText = contextResult ? contextResult.feedbackText : feedbackTextProp

  const [answer, setAnswer] = useState(initialAnswer ?? "")
  const [lastSaved, setLastSaved] = useState(initialAnswer ?? "")
  const [submissionId, setSubmissionId] = useState(initialSubmissionId ?? null)
  const [isFlagged, setIsFlagged] = useState(initialIsFlagged ?? false)

  // Local optimistic pending state — set to true immediately after the pupil saves an answer.
  // Cleared when a marking result arrives in context (effectiveIsPendingMarkingFromProps → false).
  const [isPendingMarking, setIsPendingMarking] = useState(initialIsPendingMarking)

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

  // Sync isPendingMarking when the server re-renders with fresh props (e.g. manual browser refresh).
  useEffect(() => {
    setIsPendingMarking(initialIsPendingMarking)
  }, [initialIsPendingMarking])

  // When a marking result arrives in context, clear the optimistic pending state.
  // We depend on contextResult directly — NOT on effectiveIsPendingMarkingFromProps — because
  // that derived value is false both before (no context result, already-marked activity) and
  // after (context result present) for re-submissions, so its dependency never changes.
  useEffect(() => {
    if (contextResult) {
      console.log(`[PupilShortTextActivity ${activity.activity_id.slice(0, 8)}] context result received — clearing isPendingMarking`, contextResult)
      setIsPendingMarking(false)
    }
  }, [contextResult, activity.activity_id])

  // Debug: log effective state whenever it changes
  useEffect(() => {
    console.log(`[PupilShortTextActivity ${activity.activity_id.slice(0, 8)}] effective state`, {
      fromContext: !!contextResult,
      scoreLabel: effectiveScoreLabel,
      feedbackText: effectiveFeedbackText,
      isPendingMarking,
      contextResult,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextResult, isPendingMarking])

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
        // Optimistic: show "awaiting marking" immediately — the SSE result will clear this
        setIsPendingMarking(true)
        console.log(`[PupilShortTextActivity ${activity.activity_id.slice(0, 8)}] answer saved — isPendingMarking set to true (optimistic)`)
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
        <h4 className="text-lg font-semibold text-foreground">
          {activity.title || "Short text question"}
        </h4>
      </header>

      {initialResubmitRequested && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/30">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Resubmission requested
            </p>
            {resubmitNote && (
              <p className="text-sm text-amber-600 dark:text-amber-300">{resubmitNote}</p>
            )}
          </div>
        </div>
      )}

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

      <ActivityProgressPanel
        assignmentIds={feedbackAssignmentIds}
        lessonId={feedbackLessonId ?? lessonId}
        initialVisible={feedbackInitiallyVisible}
        show={true}
        scoreLabel={effectiveScoreLabel}
        feedbackText={effectiveFeedbackText}
        modelAnswer={modelAnswer}
        isMarked={!isPendingMarking && effectiveScoreLabel !== "In progress" && effectiveScoreLabel !== "No score yet"}
        isPendingMarking={isPendingMarking}
        flagSlot={submissionId ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
        ) : undefined}
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
