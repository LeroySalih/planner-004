"use client"

import { useCallback, useEffect, useMemo, useState, useTransition, useRef } from "react"
import { toast } from "sonner"
import { Loader2, CheckCircle2 } from "lucide-react"

import type { LessonActivity } from "@/types"
import { getRichTextMarkup, getShortTextBody } from "@/components/lessons/activity-view/utils"
import { saveRevisionAnswer } from "@/actions/revisions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface RevisionShortTextActivityProps {
  revisionId: string
  activity: LessonActivity
  canAnswer: boolean
  stepNumber: number
  initialAnswer: string | null
  feedbackText?: string | null
  score?: number | null
}

type FeedbackState = { type: "success" | "error"; message: string } | null

export function RevisionShortTextActivity({
  revisionId,
  activity,
  canAnswer,
  stepNumber,
  initialAnswer,
  feedbackText,
  score,
}: RevisionShortTextActivityProps) {
  const shortTextBody = useMemo(() => getShortTextBody(activity), [activity])
  const questionMarkup = getRichTextMarkup(shortTextBody.question)
  
  const [answer, setAnswer] = useState(initialAnswer ?? "")
  const [lastSaved, setLastSaved] = useState(initialAnswer ?? "")
  const [feedback, setFeedback] = useState<FeedbackState>(
    initialAnswer ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()
  const isSavingRef = useRef(false)

  useEffect(() => {
    const nextAnswer = initialAnswer ?? ""
    setAnswer(nextAnswer)
    setLastSaved(nextAnswer)
    setFeedback(nextAnswer ? { type: "success", message: "Answer saved" } : null)
  }, [initialAnswer, activity.activity_id])

  const handleSave = useCallback(() => {
    if (!canAnswer || isSavingRef.current) return

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
        await saveRevisionAnswer(revisionId, activity.activity_id, { answer: trimmedAnswer })
        setLastSaved(trimmedAnswer)
        setFeedback({ type: "success", message: "Answer saved" })
      } catch (error) {
        toast.error("Unable to save answer")
        setFeedback({ type: "error", message: "Unable to save your answer." })
      } finally {
        isSavingRef.current = false
      }
    })
  }, [answer, canAnswer, lastSaved, revisionId, activity.activity_id])

  const handleBlur = useCallback(() => {
    if (!isPending && !isSavingRef.current) {
        handleSave()
    }
  }, [handleSave, isPending])

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {stepNumber}
        </span>
        <h4 className="text-lg font-semibold text-foreground">{activity.title || "Short text question"}</h4>
        {!canAnswer && (score === null || score === undefined) ? (
            <Badge variant="outline" className="border-slate-700 text-slate-300 bg-slate-800">
                Not Yet Marked
            </Badge>
        ) : score !== null && score !== undefined ? (
            <Badge variant="outline" className={score > 0 ? "border-green-600 text-green-700 bg-green-50" : "border-red-200 text-red-700 bg-red-50"}>
                Score: {Math.round(score * 100) / 100} / 1
            </Badge>
        ) : null}

      </header>
      
      <section className="space-y-2">
        {questionMarkup ? (
          <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: questionMarkup }} />
        ) : (
          <p className="text-base text-foreground">{shortTextBody.question?.trim() || "Question text missing."}</p>
        )}
      </section>

      <section className="space-y-2">
        <Input
          value={answer}
          onChange={(e) => {
             setAnswer(e.target.value)
             setFeedback(null)
          }}
          onBlur={handleBlur}
          placeholder="Type your short answer"
          disabled={!canAnswer || isPending}
        />
        <div className="text-xs text-muted-foreground">
           {isPending ? "Saving..." : feedback?.message}
        </div>
      </section>

      {(!canAnswer && !feedbackText) ? (
          <div className="mt-4 rounded-md bg-muted p-3 text-sm">
            <p className="font-semibold">Feedback:</p>
            <p className="text-muted-foreground italic">Not Yet Marked</p>
          </div>
      ) : feedbackText ? (
          <div className="mt-4 rounded-md bg-muted p-3 text-sm">
            <p className="font-semibold">Feedback:</p>
            <p className="whitespace-pre-wrap">{feedbackText}</p>
          </div>
      ) : null}
      
      {canAnswer && (
        <div className="flex flex-wrap items-center gap-2">
           <Button onClick={handleSave} disabled={isPending || answer === lastSaved}>
             {isPending ? "Saving..." : "Save answer"}
           </Button>
        </div>
      )}
    </div>
  )
}
