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
} from "@/lib/server-updates"
import { saveRevisionAnswer } from "@/actions/revisions"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface RevisionMcqActivityProps {
  revisionId: string
  activity: LessonActivity
  canAnswer: boolean
  stepNumber: number
  initialSelection: string | null
  feedbackText?: string | null
  score?: number | null
}

type FeedbackState = { type: "success" | "error"; message: string } | null

export function RevisionMcqActivity({
  revisionId,
  activity,
  canAnswer,
  stepNumber,
  initialSelection,
  feedbackText,
  score,
}: RevisionMcqActivityProps) {
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
  
  useEffect(() => {
    const nextInitial = initialSelection && optionMap.has(initialSelection) ? initialSelection : null
    setSelection(nextInitial)
    setLastSaved(nextInitial)
    setFeedback(nextInitial ? { type: "success", message: "Answer saved" } : null)
  }, [initialSelection, optionMap, activity.activity_id])

  useEffect(() => {
    let cancelled = false
    const directUrl = mcqBody.imageUrl && isAbsoluteUrl(mcqBody.imageUrl) ? mcqBody.imageUrl : null

    if (directUrl) {
      setImageState({ url: directUrl, loading: false, error: null })
      return () => { cancelled = true }
    }

    const fileName = mcqBody.imageFile && !isAbsoluteUrl(mcqBody.imageFile) ? mcqBody.imageFile : null
    if (!fileName) {
      setImageState({ url: null, loading: false, error: null })
      return () => { cancelled = true }
    }

    setImageState({ url: null, loading: true, error: null })
    getActivityFileDownloadUrlAction(activity.lesson_id || "", activity.activity_id, fileName)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.url) {
          setImageState({ url: result.url, loading: false, error: null })
        } else {
          setImageState({ url: null, loading: false, error: result.error ?? "Unable to load the question image." })
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error("Failed to load MCQ image:", error)
        setImageState({ url: null, loading: false, error: "Unable to load image." })
      })

    return () => { cancelled = true }
  }, [activity.activity_id, activity.lesson_id, mcqBody.imageFile, mcqBody.imageUrl])

  const handleSelect = useCallback(
    (optionId: string) => {
      if (!canAnswer || optionId === selection) return

      if (!optionMap.has(optionId)) {
        toast.error("That option is no longer available.")
        return
      }

      const previous = selection
      setSelection(optionId)
      setFeedback(null)

      startTransition(async () => {
        try {
            await saveRevisionAnswer(revisionId, activity.activity_id, { optionId })
            setLastSaved(optionId)
            setFeedback({ type: "success", message: "Answer saved" })
        } catch (error) {
            toast.error("Unable to save your answer")
            setSelection(previous)
            setFeedback({ type: "error", message: "Unable to save your answer." })
        }
      })
    },
    [activity.activity_id, canAnswer, revisionId, optionMap, selection],
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
        {score !== null && score !== undefined && (
            <Badge variant="outline" className={score > 0 ? "border-green-600 text-green-700 bg-green-50" : "border-red-200 text-red-700 bg-red-50"}>
                Score: {Math.round(score * 100) / 100} / 1
            </Badge>
        )}
      </header>

      <section className="space-y-2">
        {questionMarkup ? (
          <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: questionMarkup }} />
        ) : (
          <p className="text-base text-foreground">{question || "No question text."}</p>
        )}
      </section>

      {imageState.loading ? (
        <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          Loading image…
        </div>
      ) : imageState.url ? (
        <ActivityImagePreview
          imageUrl={imageState.url}
          alt={mcqBody.imageAlt || question || "Question image"}
          objectFit="contain"
        />
      ) : null}

      <section className="space-y-3">
        {hasOptions ? (
          <RadioGroup value={currentSelection} onValueChange={handleSelect} className="space-y-3">
            {mcqBody.options.map((option, index) => {
              const optionId = option.id
              const isSelected = optionId === selection
              const optionText = option.text.trim() || `Option ${index + 1}`

              return (
                <label
                  key={optionId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 transition",
                    isSelected && "border-primary bg-primary/5",
                    (!canAnswer || isPending) && "cursor-not-allowed opacity-90",
                  )}
                >
                  <RadioGroupItem value={optionId} disabled={!canAnswer || isPending} className="mt-1" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{optionText}</p>
                    <p className="text-xs text-muted-foreground">Choice {index + 1}</p>
                  </div>
                </label>
              )
            })}
          </RadioGroup>
        ) : (
          <p className="text-sm text-muted-foreground">No options available.</p>
        )}
      </section>
      
      {feedbackText && (
          <div className="mt-4 rounded-md bg-muted p-3 text-sm">
            <p className="font-semibold">Feedback:</p>
            <p>{feedbackText}</p>
          </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 text-xs">
        {isPending ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...
          </span>
        ) : feedback && canAnswer ? (
          <Badge variant={feedback.type === "success" ? "default" : "destructive"} className="inline-flex items-center gap-2">
            {feedback.type === "success" && <CheckCircle2 className="h-3.5 w-3.5" />}
            {feedback.message}
          </Badge>
        ) : null}
      </footer>
    </div>
  )
}
