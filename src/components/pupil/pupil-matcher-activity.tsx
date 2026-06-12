"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2 } from "lucide-react"

import type { LessonActivity, MatcherLayoutEntry } from "@/types"
import {
  getMatcherBody,
} from "@/components/lessons/activity-view/utils"
import { upsertMatcherSubmissionAction } from "@/lib/server-updates"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface PupilMatcherActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  initialLayout: MatcherLayoutEntry[]
  initialAnswers: Record<string, string | null>
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function buildLayout(pairIds: string[]): MatcherLayoutEntry[] {
  return pairIds.map((pairId) => ({
    pairId,
    promptSide: Math.random() < 0.5 ? "term" : "definition",
  }))
}

export function PupilMatcherActivity({
  lessonId,
  activity,
  pupilId,
  canAnswer,
  initialLayout,
  initialAnswers,
}: PupilMatcherActivityProps) {
  const matcherBody = useMemo(() => getMatcherBody(activity), [activity])
  const pairById = useMemo(
    () => new Map(matcherBody.pairs.map((pair) => [pair.id, pair])),
    [matcherBody.pairs],
  )
  const pairIds = useMemo(() => matcherBody.pairs.map((pair) => pair.id), [matcherBody.pairs])

  const layout = useMemo<MatcherLayoutEntry[]>(() => {
    const hasValidLayout =
      initialLayout.length === pairIds.length &&
      pairIds.every((id) => initialLayout.some((entry) => entry.pairId === id))
    return hasValidLayout ? initialLayout : buildLayout(pairIds)
  }, [initialLayout, pairIds])

  const [answers, setAnswers] = useState<Record<string, string | null>>(() => {
    const next: Record<string, string | null> = {}
    pairIds.forEach((id) => {
      next[id] = initialAnswers[id] ?? null
    })
    return next
  })
  const initialAllAnswered = pairIds.length > 0 && pairIds.every((id) => Boolean(initialAnswers[id]))
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    initialAllAnswered ? { type: "success", message: "Answer saved" } : null,
  )
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const next: Record<string, string | null> = {}
    pairIds.forEach((id) => {
      next[id] = initialAnswers[id] ?? null
    })
    setAnswers(next)
    const allAnswered = pairIds.length > 0 && pairIds.every((id) => Boolean(next[id]))
    setFeedback(allAnswered ? { type: "success", message: "Answer saved" } : null)
  }, [activity.activity_id, initialAnswers, pairIds])

  const optionsBySide = useMemo(() => {
    const terms = shuffle(matcherBody.pairs.map((pair) => ({ id: pair.id, label: pair.term })))
    const definitions = shuffle(matcherBody.pairs.map((pair) => ({ id: pair.id, label: pair.definition })))
    return { term: terms, definition: definitions }
  }, [matcherBody.pairs])

  const handleAnswerChange = useCallback(
    (pairId: string, selectedPairId: string) => {
      if (!canAnswer) return

      const nextAnswers = { ...answers, [pairId]: selectedPairId }
      setAnswers(nextAnswers)
      setFeedback(null)

      startTransition(async () => {
        const result = await upsertMatcherSubmissionAction({
          activityId: activity.activity_id,
          userId: pupilId,
          layout,
          answers: nextAnswers,
        })

        if (!result.success) {
          toast.error("Unable to save your answer", {
            description: result.error ?? "Please try again later.",
          })
          setFeedback({
            type: "error",
            message: result.error ?? "Unable to save your answer. Please try again.",
          })
          return
        }

        setFeedback({ type: "success", message: "Answer saved" })
        triggerFeedbackRefresh(lessonId)
      })
    },
    [activity.activity_id, answers, canAnswer, layout, lessonId, pupilId],
  )

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <h4 className="text-lg font-semibold text-foreground">
          {activity.title || "Match the key terms to their definitions"}
        </h4>
        {!canAnswer ? (
          <p className="text-xs text-muted-foreground">
            You can review this activity, but only pupils can select answers.
          </p>
        ) : null}
      </header>

      <ul className="space-y-3">
        {layout.map(({ pairId, promptSide }) => {
          const pair = pairById.get(pairId)
          if (!pair) return null
          const promptText = promptSide === "term" ? pair.term : pair.definition
          const answerSide = promptSide === "term" ? "definition" : "term"
          const options = optionsBySide[answerSide]
          const selected = answers[pairId] ?? ""

          return (
            <li key={pairId} className="space-y-2 rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-medium text-foreground">
                {promptText.trim() || "(missing text)"}
              </p>
              <Select
                value={selected}
                onValueChange={(value) => handleAnswerChange(pairId, value)}
                disabled={!canAnswer || isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Choose a ${answerSide}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label.trim() || "(missing text)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>

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
      </footer>
    </div>
  )
}
