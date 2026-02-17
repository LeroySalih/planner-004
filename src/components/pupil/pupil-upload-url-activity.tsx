"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Flag, Loader2, RotateCcw, X } from "lucide-react"
import { z } from "zod"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getRichTextMarkup,
  getUploadUrlBody,
} from "@/components/lessons/activity-view/utils"
import { saveUploadUrlAnswerAction, toggleSubmissionFlagAction } from "@/lib/server-updates"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { ActivityProgressPanel } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/activity-progress-panel"

interface PupilUploadUrlActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber: number
  initialAnswer: string | null
  initialSubmissionId: string | null
  initialIsFlagged: boolean
  initialResubmitRequested?: boolean
  resubmitNote?: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  scoreLabel?: string
  feedbackText?: string | null
  modelAnswer?: string | null
}
//...
export function PupilUploadUrlActivity({
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
  scoreLabel = "In progress",
  feedbackText,
  modelAnswer,
}: PupilUploadUrlActivityProps) {
  const uploadUrlBody = useMemo(() => getUploadUrlBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(uploadUrlBody.question)
  const canAnswerEffective = canAnswer

  const [url, setUrl] = useState(initialAnswer ?? "")
  const [lastSaved, setLastSaved] = useState(initialAnswer ?? "")
  const [submissionId, setSubmissionId] = useState(initialSubmissionId ?? null)
  const [isFlagged, setIsFlagged] = useState(initialIsFlagged ?? false)
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    initialAnswer ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()
  const [flagPending, startFlagTransition] = useTransition()
  const isSavingRef = useRef(false)

  const isValidUrl = useMemo(() => {
    const trimmed = url.trim()
    if (!trimmed) return false
    const result = z.string().url().safeParse(trimmed)
    return result.success
  }, [url])

  useEffect(() => {
    console.log(`[PupilUploadUrlActivity] Mount/Update: ${activity.activity_id}`, { initialAnswer, initialSubmissionId, initialIsFlagged })
    const nextAnswer = initialAnswer ?? ""
    setUrl(nextAnswer)
    setLastSaved(nextAnswer)
    setSubmissionId(initialSubmissionId ?? null)
    setIsFlagged(initialIsFlagged ?? false)
    if (nextAnswer) {
        setFeedback({ type: "success", message: "Answer saved" })
    }
  }, [initialAnswer, initialSubmissionId, initialIsFlagged, activity.activity_id])

  const handleSave = useCallback(() => {
    if (!canAnswerEffective || isSavingRef.current) {
      return
    }

    const trimmedUrl = url.trim()
    const trimmedLastSaved = lastSaved.trim()

    if (trimmedUrl === trimmedLastSaved) {
      setFeedback(trimmedUrl ? { type: "success", message: "Answer saved" } : null)
      return
    }

    if (!isValidUrl) {
        setFeedback({ type: "error", message: "Please enter a valid URL." })
        return
    }

    setFeedback(null)
    isSavingRef.current = true

    startTransition(async () => {
      try {
        const assignmentId = feedbackAssignmentIds && feedbackAssignmentIds.length > 0
          ? feedbackAssignmentIds[0]
          : undefined

        const result = await saveUploadUrlAnswerAction({
          activityId: activity.activity_id,
          userId: pupilId,
          url: trimmedUrl,
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

        setLastSaved(trimmedUrl)
        setFeedback({ type: "success", message: "Answer saved" })
        triggerFeedbackRefresh(lessonId)
      } finally {
        isSavingRef.current = false
      }
    })
  }, [activity.activity_id, url, canAnswerEffective, lastSaved, lessonId, pupilId, startTransition, feedbackAssignmentIds, isValidUrl])

  const handleBlur = useCallback(() => {
    if (!isPending && !isSavingRef.current && url.trim().length > 0) {
      handleSave()
    }
  }, [handleSave, isPending, url])

  const handleClear = useCallback(() => {
    setUrl("")
    setFeedback(null)
  }, [])

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
    if (!url.trim()) {
        return "Paste a link to your work here."
    }
    if (!isValidUrl) {
        return <span className="text-destructive">Invalid URL format.</span>
    }
    if (!feedback) {
      return "Your teacher will mark this after the lesson."
    }
    return feedback.type === "success" ? feedback.message : feedback.message
  }, [canAnswerEffective, feedback, isPending, url, isValidUrl])

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {stepNumber}
        </span>
        <h4 className="text-lg font-semibold text-foreground">
          {activity.title || "Upload URL"}
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
            {uploadUrlBody.question?.trim() || "Your teacher will add the question soon."}
          </p>
        )}
        {!canAnswerEffective ? (
          <p className="text-xs text-muted-foreground">
            You can review this question, but only pupils can enter an answer.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <div className="relative">
            <Input
            value={url}
            onChange={(event) => {
                setUrl(event.target.value)
                setFeedback(null)
            }}
            onBlur={handleBlur}
            placeholder="https://..."
            disabled={!canAnswerEffective || isPending}
            className={!isValidUrl && url.trim().length > 0 ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {url.trim().length > 0 && canAnswerEffective && !isPending && (
                <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={handleClear}
                title="Clear URL"
                >
                <X className="h-4 w-4" />
                </Button>
            )}
        </div>
        <div
          className={cnFeedback(feedback)}
        >
          {helperMessage}
        </div>
      </section>

      {canAnswerEffective ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={isPending || !isValidUrl || url.trim().length === 0}>
            {isPending ? "Saving…" : "Save answer"}
          </Button>
          <p className="text-xs text-muted-foreground">
            You can edit your answer until your teacher marks the work.
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

function cnFeedback(feedback: { type: "success" | "error"; message: string } | null): string {
  if (!feedback) {
    return "text-xs text-muted-foreground"
  }
  if (feedback.type === "success") {
    return "text-xs font-medium text-emerald-600"
  }
  return "text-xs font-medium text-destructive"
}
