"use client"

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { format, parseISO } from "date-fns"
import { addFeedbackRefreshListener } from "@/lib/feedback-events"
import { readActivityAttemptsAction, type ActivityAttempt } from "@/lib/server-actions/activity-attempts"
import { renderFeedbackMarkup } from "@/lib/markdown-latex"
import { getRichTextMarkup } from "@/components/lessons/activity-view/utils"
import { CriterionBreakdown } from "@/components/lessons/criterion-breakdown"
import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { ChevronIcon } from "./icons"
import { useLessonProgress } from "./lesson-progress"
import { FlagForReview } from "./flag-for-review"

export type ArticleActivityVariant =
  /** H3 title with "Activity N · X marks" (match up, sort, uploads …). */
  | "task"
  /** "N · question" line (multiple choice). */
  | "question"
  /** The question is the <label> of the answer field (short and long answer). */
  | "field"

export interface ArticleActivityProps {
  activityId: string
  pupilId: string
  anchorId: string
  number: number
  variant: ArticleActivityVariant
  title: string
  /** Rich text for "question" and "field" variants. */
  question?: string
  /** id of the answer field the "field" variant labels. */
  inputId?: string
  /** A marked answer the pupil can flag for their teacher to check again. */
  flag?: { submissionId: string; isFlagged: boolean }
  /** Marked activities show a status and, once released, their feedback. */
  scorable: boolean
  maxMarks: number
  scoreLabel?: string
  isMarked?: boolean
  isPendingMarking?: boolean
  feedbackText?: string | null
  modelAnswer?: string | null
  /** Teachers see marking before it is released to pupils. */
  viewerIsTeacher?: boolean
  children: ReactNode
}

const marksText = (marks: number) => `${marks} mark${marks === 1 ? "" : "s"}`

/**
 * One activity in the lesson article: its heading, the answer area, a single
 * small status element and, once released, its feedback. Marking results that
 * arrive live (the page's SSE provider) win over the server-rendered ones.
 *
 * Answering again after feedback hides that feedback and puts the activity
 * back to "Saved". When the new answer is marked, its feedback shows first and
 * the earlier attempts follow underneath with their scores, so the pupil can
 * see how their mark changed.
 */
export function ArticleActivity({
  activityId,
  pupilId,
  anchorId,
  number,
  variant,
  title,
  question,
  inputId,
  flag,
  scorable,
  maxMarks,
  scoreLabel,
  isMarked = false,
  isPendingMarking = false,
  feedbackText,
  modelAnswer,
  viewerIsTeacher = false,
  children,
}: ArticleActivityProps) {
  const { currentVisible, markingResults } = useFeedbackVisibility()
  const { done } = useLessonProgress()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [criterionCount, setCriterionCount] = useState(0)
  // The breakdown loads each time the feedback opens; until it has, show a
  // spinner rather than "No written feedback" followed by the criteria.
  const [criteriaLoaded, setCriteriaLoaded] = useState(false)
  const handleCriteriaLoaded = useCallback((count: number) => {
    setCriterionCount(count)
    setCriteriaLoaded(true)
  }, [])
  const feedbackId = useId()

  // Set when the pupil saves an answer here. A marking result received before
  // it belongs to the previous attempt.
  const [answeredAt, setAnsweredAt] = useState<number | null>(null)
  useEffect(
    () =>
      addFeedbackRefreshListener((_lessonId, savedActivityId) => {
        if (savedActivityId !== activityId) return
        setAnsweredAt(Date.now())
        setFeedbackOpen(false)
      }),
    [activityId],
  )
  const latest = markingResults.get(activityId)
  const live = latest && (answeredAt === null || Date.parse(latest.receivedAt) > answeredAt) ? latest : undefined
  const reanswering = answeredAt !== null && !live
  const marked = !reanswering && (isMarked || Boolean(live))
  // A new live result remounts the breakdown; show the spinner until it reloads.
  const liveKey = live?.receivedAt ?? "server"
  useEffect(() => setCriteriaLoaded(false), [liveKey])
  const pending = reanswering ? false : live ? false : isPendingMarking
  const released = scorable && (currentVisible || viewerIsTeacher) && marked && !pending
  const teacherPreview = released && viewerIsTeacher && !currentVisible
  const mark = live ? (live.score !== null ? `${Math.round(live.score * maxMarks)}/${maxMarks}` : null) : scoreLabel
  const feedbackMarkup = useMemo(
    () => renderFeedbackMarkup(live ? live.feedbackText : feedbackText),
    [live, feedbackText],
  )
  const modelAnswerMarkup = useMemo(() => renderFeedbackMarkup(modelAnswer), [modelAnswer])
  const questionMarkup = question ? getRichTextMarkup(question) ?? question : null

  const status = !scorable ? null : reanswering ? (
    <StatusChip tone="saved">Saved</StatusChip>
  ) : released ? (
    <StatusChip tone="marked">{!mark || mark === "—" ? "Marked" : mark.includes("/") ? `${mark} marks` : mark}</StatusChip>
  ) : marked ? (
    <StatusChip tone="neutral">Feedback not yet released</StatusChip>
  ) : pending ? (
    <StatusChip tone="amber">Awaiting marking</StatusChip>
  ) : done.has(activityId) ? (
    <StatusChip tone="saved">Saved</StatusChip>
  ) : (
    <StatusChip tone="neutral">Not started</StatusChip>
  )

  return (
    <article id={anchorId} aria-labelledby={`${anchorId}-heading`} className="scroll-mt-28">
      {variant === "task" ? (
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={`${anchorId}-heading`} className="text-[20px] font-semibold leading-snug text-la-ink">
            {title}
          </h3>
          <p className="flex items-center gap-2 text-sm text-la-muted">
            <span>
              Activity {number}
              {scorable ? ` · ${marksText(maxMarks)}` : ""}
            </span>
            {status}
          </p>
        </header>
      ) : (
        <div className="mb-3 flex items-start justify-between gap-4">
          {variant === "field" ? (
            <label
              id={`${anchorId}-heading`}
              htmlFor={inputId}
              className="block text-[17px] font-semibold leading-snug text-la-ink [&_img]:my-3 [&_img]:rounded-lg [&_p]:inline"
            >
              <span className="mr-1.5 font-normal text-la-muted">{number} ·</span>
              {questionMarkup ? <span dangerouslySetInnerHTML={{ __html: questionMarkup }} /> : title}
            </label>
          ) : (
            <div
              id={`${anchorId}-heading`}
              className="text-[17px] font-semibold leading-snug text-la-ink [&_img]:my-3 [&_img]:rounded-lg [&_p]:inline"
            >
              <span className="mr-1.5 font-normal text-la-muted">{number} ·</span>
              {questionMarkup ? <span dangerouslySetInnerHTML={{ __html: questionMarkup }} /> : title}
            </div>
          )}
          <span className="flex flex-none items-center gap-2 pt-0.5 text-sm text-la-muted">
            {scorable ? <span className="hidden sm:inline">{marksText(maxMarks)}</span> : null}
            {status}
          </span>
        </div>
      )}

      {children}

      {released ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={feedbackOpen}
            aria-controls={feedbackId}
            onClick={() => {
              setCriteriaLoaded(false)
              setFeedbackOpen((open) => !open)
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-la-green hover:text-la-green-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green"
          >
            <ChevronIcon className={cn("h-4 w-4 transition-transform", feedbackOpen && "rotate-90")} />
            {feedbackOpen ? "Hide feedback" : "Show feedback"}
          </button>
          {feedbackOpen ? (
            <div
              id={feedbackId}
              role="region"
              aria-label={`Feedback for activity ${number}`}
              className="mt-2 rounded-[10px] border border-la-border bg-la-green-pale/60 p-4 text-[15px] leading-relaxed text-la-ink"
            >
              {teacherPreview ? (
                <p className="mb-2 text-sm font-semibold text-la-amber">
                  Preview: pupils can&apos;t see this until you release feedback.
                </p>
              ) : null}
              {!criteriaLoaded ? (
                <LoadingLine label="Loading feedback…" />
              ) : criterionCount > 0 ? null : feedbackMarkup ? (
                <div dangerouslySetInnerHTML={{ __html: feedbackMarkup }} />
              ) : (
                <p className="text-la-muted">No written feedback yet.</p>
              )}
              <div className="mt-3 empty:hidden">
                <CriterionBreakdown
                  key={liveKey}
                  activityId={activityId}
                  pupilId={pupilId}
                  onLoaded={handleCriteriaLoaded}
                />
              </div>
              {modelAnswerMarkup ? (
                <div className="mt-3 border-t border-la-border pt-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-la-muted">Model answer</p>
                  <div dangerouslySetInnerHTML={{ __html: modelAnswerMarkup }} />
                </div>
              ) : null}
              {flag && !viewerIsTeacher && !live ? <FlagForReview {...flag} /> : null}
            </div>
          ) : null}
          {feedbackOpen ? (
            <EarlierAttempts activityId={activityId} pupilId={pupilId} refreshKey={liveKey} />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/**
 * The attempts before the current one, newest first, each with its mark and
 * the feedback it received, closed until opened.
 */
function EarlierAttempts({ activityId, pupilId, refreshKey }: { activityId: string; pupilId: string; refreshKey: string }) {
  const [attempts, setAttempts] = useState<ActivityAttempt[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setAttempts(null)
    readActivityAttemptsAction(activityId, pupilId)
      .then((result) => {
        if (!cancelled) setAttempts(result.data ?? [])
      })
      .catch(() => {
        if (!cancelled) setAttempts([])
      })
    return () => {
      cancelled = true
    }
  }, [activityId, pupilId, refreshKey])

  // The first is the current attempt, shown above; list the marked ones before it.
  if (attempts === null) {
    return (
      <div className="mt-3">
        <LoadingLine label="Loading earlier attempts…" />
      </div>
    )
  }
  const earlier = attempts.slice(1).filter((attempt) => attempt.marks !== null)
  if (earlier.length === 0) return null

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-la-muted">Earlier attempts</p>
      <ul className="space-y-2">
        {earlier.map((attempt) => (
          <EarlierAttempt key={attempt.submissionId} attempt={attempt} />
        ))}
      </ul>
    </div>
  )
}

function EarlierAttempt({ attempt }: { attempt: ActivityAttempt }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const feedbackMarkup = useMemo(() => renderFeedbackMarkup(attempt.feedback), [attempt.feedback])

  return (
    <li className="rounded-[10px] border border-la-border bg-la-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-la-green"
      >
        <ChevronIcon className={cn("h-4 w-4 flex-none text-la-muted transition-transform", open && "rotate-90")} />
        <span className="flex-1 font-medium text-la-ink">
          Attempt {attempt.attemptNumber}
          {attempt.submittedAt ? (
            <span className="font-normal text-la-muted"> · {format(parseISO(attempt.submittedAt), "d MMM yyyy, HH:mm")}</span>
          ) : null}
        </span>
        <span className="rounded-full bg-la-border/60 px-2.5 py-0.5 text-xs font-semibold text-la-ink">
          {attempt.marks}/{attempt.maxMarks} marks
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="space-y-2 border-t border-la-border px-4 py-3 text-[15px] leading-relaxed text-la-ink">
          {attempt.answer ? (
            <p>
              <span className="text-la-muted">Your answer: </span>
              {attempt.answer}
            </p>
          ) : null}
          {attempt.criteria.length > 0 ? (
            <ul className="space-y-2">
              {attempt.criteria.map((criterion) => (
                <li key={criterion.successCriteriaId} className="border-l-2 border-la-green/30 pl-2">
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <span>{criterion.description}</span>
                    <span className="flex-none font-semibold">
                      {criterion.awarded} / {criterion.available}
                    </span>
                  </div>
                  {criterion.feedback ? <p className="mt-0.5 text-sm text-la-muted">{criterion.feedback}</p> : null}
                </li>
              ))}
            </ul>
          ) : feedbackMarkup ? (
            <div dangerouslySetInnerHTML={{ __html: feedbackMarkup }} />
          ) : (
            <p className="text-la-muted">No written feedback.</p>
          )}
        </div>
      ) : null}
    </li>
  )
}

function LoadingLine({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-la-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </p>
  )
}

function StatusChip({ tone, children }: { tone: "neutral" | "saved" | "amber" | "marked"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-la-border/60 text-la-muted",
        tone === "saved" && "bg-la-green-pale text-la-green",
        tone === "amber" && "bg-la-amber-bg text-la-amber",
        tone === "marked" && "bg-la-green text-white",
      )}
    >
      {children}
    </span>
  )
}
