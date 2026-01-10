"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2 } from "lucide-react"

import type { LessonActivity } from "@/types"
import { ActivityImagePreview } from "@/components/lessons/activity-image-preview"
import {
  getMcqBody,
  getRichTextMarkup,
  isAbsoluteUrl,
  type McqBody,
} from "@/components/lessons/activity-view/utils"
import {
  getActivityFileDownloadUrlAction,
  upsertMcqSubmissionAction,
} from "@/lib/server-updates"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"

interface PupilMcqActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber: number
  initialSelection: string | null
  onSelectionChange?: (optionId: string | null) => void
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
}

type FeedbackState = { type: "success" | "error"; message: string } | null

export function PupilMcqActivity({
  lessonId,
  activity,
  pupilId,
  canAnswer,
  stepNumber,
  initialSelection,
  feedbackAssignmentIds = [],
  feedbackLessonId,
  feedbackInitiallyVisible = false,
  onSelectionChange,
}: PupilMcqActivityProps) {
  const mcqBody = useMemo<McqBody>(() => getMcqBody(activity), [activity])
  const optionMap = useMemo(() => new Map(mcqBody.options.map((option) => [option.id, option])), [mcqBody.options])
  const normalizedInitial = initialSelection && optionMap.has(initialSelection) ? initialSelection : null

  const [selection, setSelection] = useState<string | null>(normalizedInitial)
  const [lastSaved, setLastSaved] = useState<string | null>(normalizedInitial)
  const [feedback, setFeedback] = useState<FeedbackState>(
    normalizedInitial ? { type: "success", message: "Answer saved" } : null,
  )
  const [imageState, setImageState] = useState<{ url: string | null; loading: boolean; error: string | null }>({
    url: null,
    loading: false,
    error: null,
  })
  const [isPending, startTransition] = useTransition()
  const { currentVisible } = useFeedbackVisibility({
    assignmentIds: feedbackAssignmentIds,
    lessonId: feedbackLessonId ?? lessonId,
    initialVisible: feedbackInitiallyVisible,
  })
  const canAnswerEffective = canAnswer

  useEffect(() => {
    console.log(`[PupilMcqActivity] Mount/Update: ${activity.activity_id}`, { initialSelection })
    const nextInitial = initialSelection && optionMap.has(initialSelection) ? initialSelection : null
    setSelection(nextInitial)
    setLastSaved(nextInitial)
    setFeedback(nextInitial ? { type: "success", message: "Answer saved" } : null)
  }, [initialSelection, optionMap, activity.activity_id])

  useEffect(() => {
    console.log(`[PupilMcqActivity] Image load effect: ${activity.activity_id}`)
    let cancelled = false

    const directUrl =
      mcqBody.imageUrl && isAbsoluteUrl(mcqBody.imageUrl) ? mcqBody.imageUrl : null

    if (directUrl) {
      setImageState({ url: directUrl, loading: false, error: null })
      return () => {
        cancelled = true
      }
    }

    const fileName =
      mcqBody.imageFile && !isAbsoluteUrl(mcqBody.imageFile) ? mcqBody.imageFile : null

    if (!fileName) {
      setImageState({ url: null, loading: false, error: null })
      return () => {
        cancelled = true
      }
    }

    setImageState({ url: null, loading: true, error: null })
    getActivityFileDownloadUrlAction(lessonId, activity.activity_id, fileName)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.url) {
          setImageState({ url: result.url, loading: false, error: null })
        } else {
          setImageState({
            url: null,
            loading: false,
            error: result.error ?? "Unable to load the question image.",
          })
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error("[pupil-lessons] Failed to load MCQ image:", error)
        setImageState({
          url: null,
          loading: false,
          error: "Unable to load the question image.",
        })
      })

    return () => {
      cancelled = true
    }
  }, [activity.activity_id, lessonId, mcqBody.imageFile, mcqBody.imageUrl])

  const handleSelect = useCallback(
    (optionId: string) => {
      if (!canAnswerEffective || optionId === selection) {
        return
      }

      if (!optionMap.has(optionId)) {
        toast.error("That option is no longer available.")
        return
      }

      const previous = selection
      setSelection(optionId)
      setFeedback(null)

      startTransition(async () => {
        const result = await upsertMcqSubmissionAction({
          activityId: activity.activity_id,
          userId: pupilId,
          optionId,
        })

        if (!result.success) {
          toast.error("Unable to save your answer", {
            description: result.error ?? "Please try again later.",
          })
          setSelection(previous ?? null)
          setFeedback({
            type: "error",
            message: result.error ?? "Unable to save your answer. Please try again.",
          })
          return
        }

        setLastSaved(optionId)
        setFeedback({ type: "success", message: "Answer saved" })
        onSelectionChange?.(optionId)
        triggerFeedbackRefresh(lessonId)
      })
    },
    [activity.activity_id, canAnswerEffective, lessonId, onSelectionChange, optionMap, pupilId, selection, startTransition],
  )

  const question = mcqBody.question.trim()
  const questionMarkup = getRichTextMarkup(mcqBody.question)
  const hasOptions = mcqBody.options.length > 0

  const currentSelection = selection ?? ""

  const savedOptionText = lastSaved ? optionMap.get(lastSaved)?.text?.trim() || null : null

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {stepNumber}
        </span>
        <h4 className="text-lg font-semibold text-foreground">{activity.title || "Multiple choice question"}</h4>
      </header>

      <section className="space-y-2">
        {questionMarkup ? (
          <div
            className="prose prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: questionMarkup }}
          />
        ) : (
          <p className="text-base text-foreground">
            {question || "The teacher hasn’t added the question text yet."}
          </p>
        )}
        {!canAnswerEffective ? (
          <p className="text-xs text-muted-foreground">
            You can review this question, but only pupils can select an answer.
          </p>
        ) : null}
      </section>

      {imageState.loading ? (
        <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          Loading image…
        </div>
      ) : imageState.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {imageState.error}
        </div>
      ) : imageState.url ? (
        <ActivityImagePreview
          imageUrl={imageState.url}
          alt={mcqBody.imageAlt || question || activity.title || "Question image"}
          objectFit="contain"
        />
      ) : null}

      <section className="space-y-3">
        {hasOptions ? (
          <RadioGroup
            value={currentSelection}
            onValueChange={handleSelect}
            className="space-y-3"
          >
            {mcqBody.options.map((option, index) => {
              const optionId = option.id
              const isSelected = optionId === selection
              const optionText = option.text.trim() || `Option ${index + 1}`

              return (
                <label
                  key={optionId}
                  htmlFor={`${activity.activity_id}-${optionId}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 transition",
                    isSelected && "border-primary bg-primary/5",
                    (!canAnswerEffective || isPending) && "cursor-not-allowed opacity-90",
                  )}
                >
                  <RadioGroupItem
                    id={`${activity.activity_id}-${optionId}`}
                    value={optionId}
                    disabled={!canAnswerEffective || isPending}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{optionText}</p>
                    <p className="text-xs text-muted-foreground">Choice {index + 1}</p>
                  </div>
                </label>
              )
            })}
          </RadioGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            The teacher hasn’t added answer options yet.
          </p>
        )}
      </section>

      <footer className="flex flex-wrap items-center gap-2 text-xs">
        {isPending ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Saving your answer…
          </span>
        ) : feedback ? (
          <Badge
            variant={feedback.type === "success" ? "default" : "destructive"}
            className="inline-flex items-center gap-2"
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : null}
            {feedback.message}
          </Badge>
        ) : null}

        {savedOptionText ? (
          <span className="text-muted-foreground">
            Saved answer: <span className="font-medium text-foreground">{savedOptionText}</span>
          </span>
        ) : null}
      </footer>
    </div>
  )
}
