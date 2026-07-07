"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

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
    <div className="space-y-3">
      {!canAnswer ? (
        <p className="text-xs text-pa-muted-3">
          You can review this activity, but only pupils can select answers.
        </p>
      ) : null}

      <ul className="space-y-3">
        {layout.map(({ pairId, promptSide }) => {
          const pair = pairById.get(pairId)
          if (!pair) return null
          const promptText = promptSide === "term" ? pair.term : pair.definition
          const answerSide = promptSide === "term" ? "definition" : "term"
          const options = optionsBySide[answerSide]
          const selected = answers[pairId] ?? ""

          return (
            <li
              key={pairId}
              className="space-y-2 rounded-pa-box border-[1.5px] border-pa-field-border bg-pa-field p-4"
            >
              <p className="text-sm font-semibold text-pa-ink">
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
    </div>
  )
}
