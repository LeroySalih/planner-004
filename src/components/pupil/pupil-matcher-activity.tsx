"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import type { LessonActivity, MatcherLayoutEntry } from "@/types"
import {
  getMatcherBody,
} from "@/components/lessons/activity-view/utils"
import { RichInline } from "@/components/lessons/activity-view/rich-inline"
import { upsertMatcherSubmissionAction } from "@/lib/server-updates"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"
import { seededRandom, seededShuffle } from "@/lib/seeded-shuffle"

interface PupilMatcherActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  initialLayout: MatcherLayoutEntry[]
  initialAnswers: Record<string, string | null>
}

function buildLayout(pairIds: string[], random: () => number): MatcherLayoutEntry[] {
  return pairIds.map((pairId) => ({
    pairId,
    promptSide: random() < 0.5 ? "term" : "definition",
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
    return hasValidLayout ? initialLayout : buildLayout(pairIds, seededRandom(`${activity.activity_id}:${pupilId}:layout`))
  }, [initialLayout, pairIds, activity.activity_id, pupilId])

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
    const random = seededRandom(`${activity.activity_id}:${pupilId}:options`)
    const terms = seededShuffle(matcherBody.pairs.map((pair) => ({ id: pair.id, label: pair.term })), random)
    const definitions = seededShuffle(matcherBody.pairs.map((pair) => ({ id: pair.id, label: pair.definition })), random)
    return { term: terms, definition: definitions }
  }, [matcherBody.pairs, activity.activity_id, pupilId])

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
        triggerFeedbackRefresh(lessonId, activity.activity_id)
      })
    },
    [activity.activity_id, answers, canAnswer, layout, lessonId, pupilId],
  )

  return (
    <div className="space-y-3">
      {!canAnswer ? (
        <p className="text-sm text-pa-muted-3">
          You can review this activity, but only pupils can select answers.
        </p>
      ) : null}

      <ul className="divide-y divide-pa-card-border overflow-hidden rounded-[10px] border border-pa-card-border bg-pa-panel">
        {layout.map(({ pairId, promptSide }) => {
          const pair = pairById.get(pairId)
          if (!pair) return null
          const promptText = promptSide === "term" ? pair.term : pair.definition
          const answerSide = promptSide === "term" ? "definition" : "term"
          const options = optionsBySide[answerSide]
          const selected = answers[pairId] ?? ""
          const promptId = `${activity.activity_id}-${pairId}-prompt`

          return (
            <li key={pairId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              {/* A div: RichInline renders paragraphs, which a <p> cannot hold. */}
              <div id={promptId} className="text-[15px] text-pa-ink">
                <RichInline text={promptText.trim() || "(missing text)"} />
              </div>
              <Select
                value={selected}
                onValueChange={(value) => handleAnswerChange(pairId, value)}
                disabled={!canAnswer || isPending}
              >
                <SelectTrigger
                  aria-labelledby={promptId}
                  className="min-h-11 w-full flex-none border-pa-field-border bg-pa-field sm:w-[220px]"
                >
                  <SelectValue placeholder={`Choose a ${answerSide}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <RichInline text={option.label.trim() || "(missing text)"} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>
      {feedback?.type === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {feedback.message}
        </p>
      ) : null}
    </div>
  )
}
