"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2, X } from "lucide-react"
import { z } from "zod"

import type { LessonActivity } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getRichTextMarkup,
  getUploadUrlBody,
} from "@/components/lessons/activity-view/utils"
import { saveRevisionAnswer } from "@/actions/revisions"

interface RevisionUploadUrlActivityProps {
  revisionId: string
  activity: LessonActivity
  canAnswer: boolean
  stepNumber: number
  initialAnswer: string | null
  feedbackText?: string | null
  score?: number | null
}

type FeedbackState = { type: "success" | "error"; message: string } | null

export function RevisionUploadUrlActivity({
  revisionId,
  activity,
  canAnswer,
  stepNumber,
  initialAnswer,
  feedbackText,
  score,
}: RevisionUploadUrlActivityProps) {
  const uploadUrlBody = useMemo(() => getUploadUrlBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(uploadUrlBody.question)
  
  const [url, setUrl] = useState(initialAnswer ?? "")
  const [lastSaved, setLastSaved] = useState(initialAnswer ?? "")
  const [feedback, setFeedback] = useState<FeedbackState>(
    initialAnswer ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()
  const isSavingRef = useRef(false)

  const isValidUrl = useMemo(() => {
    const trimmed = url.trim()
    if (!trimmed) return false
    const result = z.string().url().safeParse(trimmed)
    return result.success
  }, [url])

  useEffect(() => {
    const nextAnswer = initialAnswer ?? ""
    setUrl(nextAnswer)
    setLastSaved(nextAnswer)
    if (nextAnswer) {
        setFeedback({ type: "success", message: "Answer saved" })
    }
  }, [initialAnswer, activity.activity_id])

  const handleSave = useCallback(() => {
    if (!canAnswer || isSavingRef.current) {
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
        await saveRevisionAnswer(revisionId, activity.activity_id, { url: trimmedUrl })
        setLastSaved(trimmedUrl)
        setFeedback({ type: "success", message: "Answer saved" })
      } catch (error) {
           toast.error("Unable to save your answer")
           setFeedback({ type: "error", message: "Unable to save your answer." })
      } finally {
        isSavingRef.current = false
      }
    })
  }, [activity.activity_id, url, canAnswer, lastSaved, revisionId, isValidUrl])

  const handleBlur = useCallback(() => {
    if (!isPending && !isSavingRef.current && url.trim().length > 0) {
      handleSave()
    }
  }, [handleSave, isPending, url])

  const handleClear = useCallback(() => {
    setUrl("")
    setFeedback(null)
  }, [])

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
            disabled={!canAnswer || isPending}
            className={!isValidUrl && url.trim().length > 0 ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {url.trim().length > 0 && canAnswer && !isPending && (
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
        <div className={feedback?.type === 'error' ? 'text-destructive text-xs' : 'text-emerald-600 text-xs'}>
           {isPending ? "Saving..." : feedback?.message}
        </div>
      </section>
      
      {feedbackText && (
          <div className="mt-4 rounded-md bg-muted p-3 text-sm">
            <p className="font-semibold">Feedback:</p>
            <p>{feedbackText}</p>
          </div>
      )}

      {canAnswer ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={isPending || !isValidUrl || url.trim().length === 0}>
            {isPending ? "Saving…" : "Save answer"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
