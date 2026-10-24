"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { toast } from "sonner"
import { readLessonUnderstandingAction, recordLessonUnderstandingAction } from "@/lib/server-updates"
import type { LessonUnderstanding, UnderstandingRating } from "@/lib/lesson-understanding/store"
import { cn } from "@/lib/utils"
import { ArrowRightIcon, ThumbDownIcon, ThumbUpIcon } from "./icons"

const OPTIONS: Array<{ rating: UnderstandingRating; label: string; Icon: typeof ThumbUpIcon }> = [
  { rating: "up", label: "I understand it", Icon: ThumbUpIcon },
  { rating: "down", label: "Not yet", Icon: ThumbDownIcon },
]

/**
 * "How well do I understand this lesson?" Each answer is saved with its date
 * (migration 125), so a pupil can change their mind as the lesson sinks in and
 * the change is kept. Followed by the link to the next lesson.
 */
export function LessonFooter({
  lessonId,
  pupilId,
  initialUnderstanding,
  canAnswer,
  nextLesson,
}: {
  lessonId: string
  pupilId: string
  initialUnderstanding: LessonUnderstanding | null
  /** Only the pupil themselves answers; teachers see their answer. */
  canAnswer: boolean
  nextLesson: { href: string; title: string } | null
}) {
  const [understanding, setUnderstanding] = useState(initialUnderstanding)
  const [pending, setPending] = useState<UnderstandingRating | null>(null)
  const [, startTransition] = useTransition()

  // Going back to the lesson can restore the page from the router's cache,
  // carrying the answer as it was when first loaded; read the current one.
  useEffect(() => {
    let cancelled = false
    void readLessonUnderstandingAction(lessonId, pupilId).then((result) => {
      if (!cancelled && !result.error) setUnderstanding(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [lessonId, pupilId])

  const answer = (rating: UnderstandingRating) => {
    if (!canAnswer || pending) return
    setPending(rating)
    startTransition(async () => {
      const result = await recordLessonUnderstandingAction(lessonId, rating)
      setPending(null)
      if (result.error || !result.data) {
        toast.error("Your answer wasn't saved", { description: result.error ?? "Please try again." })
        return
      }
      setUnderstanding(result.data)
      toast.success(rating === "up" ? "Great, saved." : "Saved. Ask your teacher or look back over the lesson.")
    })
  }

  const current = pending ?? understanding?.rating ?? null

  return (
    <footer className="mt-16 flex flex-col gap-6 rounded-xl border border-la-border bg-la-card p-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="lesson-understanding-title" className="font-[family-name:var(--font-source-serif)] text-[24px] font-semibold text-la-ink">
          How well do I understand this lesson?
        </h2>
        <div role="group" aria-labelledby="lesson-understanding-title" className="mt-4 flex flex-wrap gap-3">
          {OPTIONS.map(({ rating, label, Icon }) => {
            const selected = current === rating
            return (
              <button
                key={rating}
                type="button"
                aria-pressed={selected}
                disabled={!canAnswer || pending !== null}
                onClick={() => answer(rating)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green disabled:cursor-not-allowed",
                  selected
                    ? rating === "up"
                      ? "border-la-green bg-la-green-pale text-la-green"
                      : "border-la-amber bg-la-amber-bg text-la-amber"
                    : "border-la-input bg-la-card text-la-ink hover:border-la-green",
                  pending === rating && "opacity-70",
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-la-muted" role="status">
          {pending
            ? "Saving…"
            : understanding
              ? `Last answered ${format(parseISO(understanding.recordedAt), "d MMM yyyy")}. You can change your answer at any time.`
              : canAnswer
                ? "Answer when you've finished. You can change it later."
                : "No answer yet."}
        </p>
      </div>
      {nextLesson ? (
        <Link
          href={nextLesson.href}
          className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-la-green hover:text-la-green-hover focus-visible:outline-2 focus-visible:outline-la-green"
        >
          Next: {nextLesson.title}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      ) : null}
    </footer>
  )
}
