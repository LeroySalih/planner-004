"use client"

import { useMemo, type ReactNode } from "react"
import { renderFeedbackMarkup } from "@/lib/markdown-latex"
import { PupilActivityShell } from "@/components/pupil-activity/pupil-activity-shell"
import { useFeedbackVisibility } from "./feedback-visibility-debug"

export interface LiveActivityShellProps {
  activityId: string
  question: string
  activityIndex: number
  activityTotal: number
  typeLabel: string
  typeGlyph?: string
  /** Display-only activities (text/image/video/section): no marking chrome. */
  hideMarking?: boolean

  // Server-computed marking data
  scoreLabel?: string
  scoreWord?: string
  isMarked?: boolean
  isPendingMarking?: boolean
  feedbackText?: string | null
  modelAnswer?: string | null
  maxMarks?: number
  teacher?: { name: string; initials: string }

  children: ReactNode
}

/**
 * Wraps the presentational PupilActivityShell with the live feedback/marking
 * logic that ActivityProgressPanel used to own: it reads the page-level SSE
 * FeedbackVisibilityProvider so a released score / marking result appears
 * without a refresh, and only shows the 2A feedback bar once the work is
 * marked AND feedback is visible.
 */
export function LiveActivityShell({
  activityId,
  question,
  activityIndex,
  activityTotal,
  typeLabel,
  typeGlyph,
  hideMarking = false,
  scoreLabel,
  scoreWord,
  isMarked = false,
  isPendingMarking = false,
  feedbackText,
  modelAnswer,
  maxMarks = 1,
  teacher,
  children,
}: LiveActivityShellProps) {
  const { currentVisible, markingResults } = useFeedbackVisibility()
  const contextResult = markingResults.get(activityId)

  // Context (live) result wins over the server-rendered values.
  const isMarkedLive = isMarked || Boolean(contextResult)
  const isPendingLive = contextResult ? false : isPendingMarking
  const released = !hideMarking && currentVisible && isMarkedLive && !isPendingLive

  const effectiveScoreMark = contextResult
    ? contextResult.score !== null
      ? `${Math.round(contextResult.score * maxMarks)}/${maxMarks}`
      : "—"
    : scoreLabel
  const effectiveFeedbackText = contextResult ? contextResult.feedbackText : feedbackText

  const feedbackMarkup = useMemo(
    () => renderFeedbackMarkup(effectiveFeedbackText),
    [effectiveFeedbackText],
  )
  const modelAnswerMarkup = useMemo(() => renderFeedbackMarkup(modelAnswer), [modelAnswer])

  const feedbackNode: ReactNode = (
    <>
      {feedbackMarkup ? (
        <div dangerouslySetInnerHTML={{ __html: feedbackMarkup }} />
      ) : (
        <p className="text-pa-muted-2">No written feedback yet.</p>
      )}
      {modelAnswerMarkup ? (
        <div className="mt-3 border-t border-pa-green-border pt-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-pa-muted-2">
            Model answer
          </p>
          <div dangerouslySetInnerHTML={{ __html: modelAnswerMarkup }} />
        </div>
      ) : null}
    </>
  )

  return (
    <PupilActivityShell
      question={question}
      activityIndex={activityIndex}
      activityTotal={activityTotal}
      typeLabel={typeLabel}
      typeGlyph={typeGlyph}
      hideMarking={hideMarking}
      released={released}
      score={released && effectiveScoreMark ? { mark: effectiveScoreMark, word: scoreWord } : null}
      feedback={feedbackNode}
      teacher={teacher}
      awaitingLabel={isPendingLive ? "Awaiting marking" : "Feedback not yet released"}
    >
      {children}
    </PupilActivityShell>
  )
}
