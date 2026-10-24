"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import type { LessonActivity } from "@/types"
import { ActivityImagePreview } from "@/components/lessons/activity-image-preview"
import {
  getMcqBody,
  isAbsoluteUrl,
  type McqBody,
} from "@/components/lessons/activity-view/utils"
import {
  getActivityFileDownloadUrlAction,
  upsertMcqSubmissionAction,
} from "@/lib/server-updates"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import { getRichTextMarkup } from "@/components/lessons/activity-view/utils"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface PupilMcqActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  stepNumber?: number
  initialSelection: string | null
  feedbackAssignmentIds?: string[]
  feedbackLessonId?: string
  feedbackInitiallyVisible?: boolean
  onSelectionChange?: (optionId: string | null) => void
  scoreLabel?: string
  feedbackText?: string | null
  modelAnswer?: string | null
}

// ...
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
  scoreLabel = "In progress",
  feedbackText,
  modelAnswer,
}: PupilMcqActivityProps) {
  const mcqBody = useMemo<McqBody>(() => getMcqBody(activity), [activity])
  const optionMap = useMemo(() => new Map(mcqBody.options.map((option) => [option.id, option])), [mcqBody.options])
  const normalizedInitial = initialSelection && optionMap.has(initialSelection) ? initialSelection : null

  const [selection, setSelection] = useState<string | null>(normalizedInitial)
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    normalizedInitial ? { type: "success", message: "Answer saved" } : null,
  )
  const [imageState, setImageState] = useState<{ url: string | null; loading: boolean; error: string | null }>({
    url: null,
    loading: false,
    error: null,
  })
  const [isPending, startTransition] = useTransition()
  const canAnswerEffective = canAnswer

  useEffect(() => {
    console.log(`[PupilMcqActivity] Mount/Update: ${activity.activity_id}`, { initialSelection })
    const nextInitial = initialSelection && optionMap.has(initialSelection) ? initialSelection : null
    setSelection(nextInitial)
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
          assignmentId: feedbackAssignmentIds[0],
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

        setFeedback({ type: "success", message: "Answer saved" })
        onSelectionChange?.(optionId)
        triggerFeedbackRefresh(lessonId, activity.activity_id)
      })
    },
    [activity.activity_id, canAnswerEffective, feedbackAssignmentIds, lessonId, onSelectionChange, optionMap, pupilId, selection, startTransition],
  )

  const question = mcqBody.question.trim()
  const hasOptions = mcqBody.options.length > 0
  const currentSelection = selection ?? ""

  return (
    <div className="space-y-3">
      {!canAnswerEffective ? (
        <p className="text-sm text-pa-muted-3">
          You can review this question, but only pupils can select an answer.
        </p>
      ) : null}

      {imageState.loading ? (
        <div className="flex min-h-[140px] items-center justify-center rounded-pa-box border border-dashed border-pa-field-border text-sm text-pa-muted-3">
          Loading image…
        </div>
      ) : imageState.error ? (
        <div className="rounded-pa-box border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {imageState.error}
        </div>
      ) : imageState.url ? (
        <ActivityImagePreview
          imageUrl={imageState.url}
          alt={mcqBody.imageAlt || question || activity.title || "Question image"}
          objectFit="contain"
        />
      ) : null}

      {hasOptions ? (
        <RadioGroup
          value={currentSelection}
          onValueChange={handleSelect}
          aria-labelledby={`activity-${activity.activity_id}-heading`}
          className="grid gap-2.5 sm:grid-cols-2"
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
                  "flex min-h-11 items-center gap-3 rounded-[10px] border px-4 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-pa-green/40",
                  canAnswerEffective && !isPending ? "cursor-pointer" : "cursor-not-allowed",
                  isSelected
                    ? "border-2 border-pa-green bg-pa-green-tint px-[15px]"
                    : "border-pa-field-border bg-pa-field hover:border-pa-green",
                )}
              >
                <RadioGroupItem
                  id={`${activity.activity_id}-${optionId}`}
                  value={optionId}
                  disabled={!canAnswerEffective || isPending}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "grid h-5 w-5 flex-none place-items-center rounded-full border-2",
                    isSelected ? "border-pa-green" : "border-pa-key-border",
                  )}
                >
                  {isSelected ? <span className="h-2.5 w-2.5 rounded-full bg-pa-green" /> : null}
                </span>
                <span className="mr-0.5 text-sm font-semibold text-pa-muted-2" aria-hidden>
                  {String.fromCharCode(65 + index)}
                </span>
                <span
                  className={cn("prose prose-sm max-w-none text-[15px] text-pa-ink [&_p]:my-0 [&_p]:inline", isSelected && "font-semibold")}
                  dangerouslySetInnerHTML={{ __html: getRichTextMarkup(optionText) ?? optionText }}
                />
              </label>
            )
          })}
        </RadioGroup>
      ) : (
        <p className="text-sm text-pa-muted-3">The teacher hasn’t added answer options yet.</p>
      )}

      <div role="status" className="flex min-h-5 flex-wrap items-center gap-2 text-sm text-pa-muted-3">
        {isPending ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Saving your answer…
          </span>
        ) : feedback?.type === "error" ? (
          <span className="text-destructive">{feedback.message}</span>
        ) : null}
      </div>
    </div>
  )
}
