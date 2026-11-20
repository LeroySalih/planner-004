"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { format, parseISO } from "date-fns"
import { Flag } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import type { QuestionFlagHistoryEntry } from "@/lib/assessment-paper/question-flags"
import type { AssessmentResultCriterion, AssessmentResultQuestion } from "@/lib/assessment-paper/results"
import { assessmentFeedbackPdfUrl } from "@/lib/assessment-paper/urls"
import {
  EvidenceTexts,
  EvidenceThumbnails,
  formatUploadedAt,
  MarkerEvidenceNote,
  PowerPointFilesBlock,
} from "@/components/assignment-results/powerpoint-evidence"
import { MarkedAgainst, MarkerReason, MarkRowLabel } from "@/components/assignment-results/marking-reference"
import {
  clearAssessmentQuestionFlagAction,
  confirmAssessmentQuestionAction,
  readAssessmentPaperMarkingAction,
  setAssessmentAnswerTranscriptionAction,
  setAssessmentQuestionCriterionCommentAction,
  setAssessmentQuestionCriterionMarkAction,
  type AssessmentPaperMarking,
} from "@/lib/server-actions/assessment-paper-results"

interface AssessmentPaperMarksPanelProps {
  activityId: string
  pupilId: string
  /** A particular attempt; the pupil's latest when omitted. */
  submissionId?: string | null
  /** Called after a mark changes the paper's total. */
  onAggregateChange?: (aggregate: { awarded: number; available: number } | null) => void
  /**
   * Reports, once loaded, whether there is work to mark: a script (assessment
   * paper) or handed-in files (practical assessment).
   */
  onLoaded?: (state: { hasWork: boolean }) => void
  /** The grid's flag for this pupil; the panel reads its flags again when it changes. */
  flagged?: boolean
}

const MARK_STATUS_LABELS: Record<string, string> = {
  waiting: "Waiting to be marked",
  marking: "Marking",
  marked: "Marked",
  "marking-error": "Marking failed",
}

const MARKING_LABELS: Record<AssessmentResultQuestion["marking"], string> = {
  ai: "AI",
  ai_check: "AI, teacher checks",
  teacher: "Teacher only",
}

const ANSWER_STATUS_LABELS: Record<string, string> = {
  answered: "Answered",
  blank: "Blank",
  unreadable: "Unreadable",
  continued: "Continued elsewhere",
}

function MarkButtons({
  max,
  selected,
  disabled,
  onSelect,
}: {
  max: number
  selected: number | null
  disabled: boolean
  onSelect: (value: number) => void
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {Array.from({ length: max + 1 }, (_, level) => (
        <button
          key={level}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(level)}
          className={`rounded border px-2 py-0.5 text-xs transition disabled:opacity-50 ${
            selected === level
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          }`}
        >
          {level}
        </button>
      ))}
    </div>
  )
}

function ProvenanceBadge({ provenance }: { provenance: string | null }) {
  if (provenance === "teacher") return <Badge variant="secondary" className="text-[10px]">Teacher</Badge>
  if (provenance === "legacy") {
    return (
      <Badge
        variant="outline"
        className="text-[10px]"
        title="Carried over from the old assessment, not assessed here. AI re-marking replaces it; marking it yourself makes it yours."
      >
        Filled in
      </Badge>
    )
  }
  if (provenance === "ai") return <Badge variant="outline" className="text-[10px]">AI</Badge>
  return null
}

function formatDay(iso: string) {
  try {
    return format(parseISO(iso), "dd-MM-yyyy")
  } catch {
    return iso
  }
}

/** One ended flag, in a line: what the teacher did with it, or that the pupil withdrew it. */
function flagHistoryLine(entry: QuestionFlagHistoryEntry) {
  if (entry.outcome === "withdrawn") {
    return `Flagged ${formatDay(entry.flaggedAt)}: the pupil withdrew the flag${entry.withdrawnAt ? ` ${formatDay(entry.withdrawnAt)}` : ""}.`
  }
  const cleared = `Flag cleared ${entry.resolvedAt ? formatDay(entry.resolvedAt) : ""}`.trim()
  const mark = (value: number | null) => (value === null ? "unmarked" : String(value))
  return entry.outcome === "changed"
    ? `${cleared}: mark changed ${mark(entry.awardedAtFlag)} → ${mark(entry.awardedAtResolve)}.`
    : `${cleared}: mark unchanged (${mark(entry.awardedAtResolve)}).`
}

/** A practical task the reader answers with the pupil's typed text, which a teacher may correct. */
function readsTypedText(question: AssessmentResultQuestion) {
  return question.evidenceSources.some((source) => source.source === "evidence_section" && source.want === "text")
}

/**
 * An assessment paper for one pupil, as the results sidebar shows it: their
 * script (original and markable pages), and each question with what the
 * reader found (editable), its mark and its criteria. A practical
 * (PowerPoint or database) assessment shows the pupil's files instead, and
 * per task the evidence the marker was given, its pictures, its database
 * report and the marker's note; only a task read
 * from typed text has an editable answer. A teacher marks a
 * criterion within its question out of its allocation (on a one-criterion
 * question, the question's mark is that criterion's); the question and the
 * paper are recomputed from those marks. A criterion's comment overrides the
 * marker's. Questions the teacher should check are flagged, with Confirm.
 */
export function AssessmentPaperMarksPanel({
  activityId,
  pupilId,
  submissionId,
  onAggregateChange,
  onLoaded,
  flagged,
}: AssessmentPaperMarksPanelProps) {
  const [result, setResult] = useState<AssessmentPaperMarking | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [transcriptionDrafts, setTranscriptionDrafts] = useState<Record<string, string>>({})
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  }, [onLoaded])

  const load = useCallback(async () => {
    setLoading(true)
    const response = await readAssessmentPaperMarkingAction({ activityId, pupilId, submissionId: submissionId ?? null })
    setResult(response.data ?? null)
    setError(response.error ?? null)
    setLoading(false)
    onLoadedRef.current?.({
      hasWork: Boolean(response.data?.script) || Boolean(response.data?.powerpoint?.handedIn),
    })
  }, [activityId, pupilId, submissionId])

  useEffect(() => {
    void load()
  }, [load])

  // The grid's flag changes when the pupil flags a question or a teacher
  // clears them all from the grid; read the flags back so the panel agrees.
  const flaggedRef = useRef(flagged)
  useEffect(() => {
    if (flaggedRef.current === flagged) return
    flaggedRef.current = flagged
    void load()
  }, [flagged, load])

  const setAwarded = (questionId: string, criterion: AssessmentResultCriterion, awarded: number) => {
    const target = result?.submissionId
    if (!target) return
    startTransition(async () => {
      const response = await setAssessmentQuestionCriterionMarkAction({
        submissionId: target,
        questionId,
        successCriteriaId: criterion.successCriteriaId,
        awarded,
      })
      if (response.error) {
        toast.error(response.error)
        return
      }
      const totals = response.data?.totals ?? null
      onAggregateChange?.(totals ? { awarded: totals.awarded, available: totals.available } : null)
      // A first mark on a legacy question splits it, which moves its other
      // criteria too, so the paper is read back rather than patched.
      await load()
      toast.success("Mark updated.")
    })
  }

  const saveTranscription = (questionId: string, transcription: string) => {
    const target = result?.submissionId
    if (!target) return
    startTransition(async () => {
      const response = await setAssessmentAnswerTranscriptionAction({
        submissionId: target,
        questionId,
        transcription,
      })
      if (response.error || !response.data) {
        toast.error(response.error ?? "Unable to save the transcription.")
        return
      }
      const answer = response.data.answer
      setResult((prev) =>
        prev
          ? { ...prev, questions: prev.questions.map((q) => (q.questionId === questionId ? { ...q, answer } : q)) }
          : prev,
      )
      setTranscriptionDrafts((prev) => {
        const next = { ...prev }
        delete next[questionId]
        return next
      })
      toast.success("Transcription saved.")
    })
  }

  const confirmQuestion = (questionId: string) => {
    const target = result?.submissionId
    if (!target) return
    startTransition(async () => {
      const response = await confirmAssessmentQuestionAction({ submissionId: target, questionId })
      if (response.error) {
        toast.error(response.error)
        return
      }
      const totals = response.data?.totals ?? null
      onAggregateChange?.(totals ? { awarded: totals.awarded, available: totals.available } : null)
      await load()
      toast.success("Marks confirmed.")
    })
  }

  const clearFlag = (questionId: string) => {
    const target = result?.submissionId
    if (!target) return
    startTransition(async () => {
      const response = await clearAssessmentQuestionFlagAction({ submissionId: target, questionId })
      if (response.error) {
        toast.error(response.error)
        return
      }
      await load()
      toast.success("Flag cleared.")
    })
  }

  const saveComment = (questionId: string, criterion: AssessmentResultCriterion, feedback: string) => {
    const target = result?.submissionId
    if (!target) return
    const key = `${questionId}|${criterion.successCriteriaId}`
    startTransition(async () => {
      const response = await setAssessmentQuestionCriterionCommentAction({
        submissionId: target,
        questionId,
        successCriteriaId: criterion.successCriteriaId,
        feedback,
      })
      if (response.error) {
        toast.error(response.error)
        return
      }
      const saved = response.data?.feedback ?? null
      setResult((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((q) =>
                q.questionId !== questionId
                  ? q
                  : {
                      ...q,
                      criteria: q.criteria.map((c) =>
                        c.successCriteriaId === criterion.successCriteriaId ? { ...c, teacherFeedback: saved } : c,
                      ),
                    },
              ),
            }
          : prev,
      )
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      toast.success(saved ? "Comment saved." : "Comment cleared.")
    })
  }

  if (loading && !result) {
    return <p className="text-sm text-muted-foreground">Loading paper…</p>
  }
  if (error || !result) {
    return <p className="text-sm text-destructive">{error ?? "Unable to load the paper."}</p>
  }

  const canMark = Boolean(result.submissionId)
  const flaggedCount = Object.values(result.questionFlags).filter((flag) => flag.open).length
  const powerPoint = result.powerpoint
  const work = powerPoint ? "work" : "script"

  const renderComment = (questionId: string, criterion: AssessmentResultCriterion) => {
    const key = `${questionId}|${criterion.successCriteriaId}`
    const marked = criterion.awarded !== null
    const short = criterion.awarded !== null && criterion.awarded < criterion.available
    return (
      <>
        {/* The marker's reason, shown while it still explains a mark short of full. */}
        {!criterion.teacherFeedback && short ? (
          <MarkerReason whyNotAwarded={criterion.whyNotAwarded} howToImprove={criterion.howToImprove} />
        ) : null}

        {criterion.provenance === "teacher" && !criterion.teacherFeedback && !criterion.whyNotAwarded &&
        !criterion.howToImprove && criterion.awarded !== null && criterion.awarded < criterion.available ? (
          <p className="mt-1 text-xs italic text-muted-foreground">
            No comment for the pupil on this mark. Add your own below.
          </p>
        ) : null}

        {marked ? (
          <textarea
            value={drafts[key] ?? criterion.teacherFeedback ?? ""}
            disabled={isPending}
            placeholder="Your comment for this criterion (overrides the AI's)"
            rows={2}
            onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (next !== (criterion.teacherFeedback ?? "")) {
                saveComment(questionId, criterion, next)
              }
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        ) : null}
      </>
    )
  }

  // An unsplit legacy row is out of the question's marks, so its mark is only
  // "selected" once it is out of the allocation the buttons offer.
  const selectedLevel = (criterion: AssessmentResultCriterion) =>
    criterion.awarded !== null && criterion.available === criterion.allocation ? criterion.awarded : null

  return (
    <div className="space-y-3">
      {result.submissionId ? (
        <a
          href={assessmentFeedbackPdfUrl(activityId, pupilId)}
          className="inline-flex text-xs font-medium text-primary hover:underline"
          title="The PDF the pupil downloads once feedback is released"
        >
          Feedback PDF
        </a>
      ) : null}
      {powerPoint ? (
        <PowerPointFilesBlock
          activityId={activityId}
          pupilId={pupilId}
          files={powerPoint}
          markStatusLine={
            result.markStatus
              ? `${MARK_STATUS_LABELS[result.markStatus] ?? result.markStatus}${result.markError ? `: ${result.markError}` : ""}`
              : result.markError
          }
          onChanged={load}
        />
      ) : (
        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Script</p>
          {result.script ? (
            <div className="mt-1 space-y-1">
              <p className="text-xs text-muted-foreground">
                Uploaded {formatUploadedAt(result.script.uploadedAt)} · {result.script.pageCount} page
                {result.script.pageCount === 1 ? "" : "s"}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <a
                  href={result.script.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Original script
                </a>
                {result.script.pages.map((page) => (
                  <a
                    key={page.url}
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                    title="What the marker sees"
                  >
                    p{page.pageNumber}
                  </a>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {result.script.frontSheetCheck === "passed"
                  ? "Front sheet check passed: pages 2 onwards can be marked."
                  : result.script.frontSheetCheck
                    ? `Front sheet check failed. ${result.script.frontSheetCheck}`
                    : "Front sheet not checked: this script is never sent for marking."}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-foreground">No script uploaded.</p>
          )}
          {result.markStatus ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {MARK_STATUS_LABELS[result.markStatus] ?? result.markStatus}
              {result.markError ? `: ${result.markError}` : ""}
            </p>
          ) : result.markError && (!result.script || result.markError !== result.script.frontSheetCheck) ? (
            // e.g. a folded paper, or no script
            <p className="mt-1 text-xs text-muted-foreground">{result.markError}</p>
          ) : null}
        </div>
      )}

      {flaggedCount > 0 ? (
        <div className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs font-medium text-foreground">
          <Flag className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
          {flaggedCount} question{flaggedCount === 1 ? "" : "s"} flagged by the pupil.
        </div>
      ) : null}

      {result.awaitingCheckCount > 0 || result.paperAwaitingCheck.questions > 0 ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          {result.awaitingCheckCount > 0 ? (
            <p className="font-medium">
              {result.awaitingCheckCount} question{result.awaitingCheckCount === 1 ? "" : "s"} on this {work}
              {result.awaitingCheckCount === 1 ? " awaits" : " await"} your check.
            </p>
          ) : null}
          <p className="text-muted-foreground">
            Across the {powerPoint ? "assessment" : "paper"}: {result.paperAwaitingCheck.questions} question
            {result.paperAwaitingCheck.questions === 1 ? "" : "s"} on {result.paperAwaitingCheck.pupils} pupil
            {result.paperAwaitingCheck.pupils === 1 ? `'s ${work}` : `s' ${work}${powerPoint ? "" : "s"}`} to check.
          </p>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-foreground">Questions</h4>
        <span className="text-sm font-medium text-foreground">
          {result.marksAwarded ?? "—"} / {result.maxMarks}
        </span>
      </div>

      {result.questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">This paper has no questions yet. Add them in the lesson.</p>
      ) : null}

      {!canMark && result.questions.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {powerPoint
            ? "Marks can be given once the pupil has uploaded their files."
            : "Marks can be given once the pupil's script has been uploaded."}
        </p>
      ) : null}

      <ul className="space-y-3">
        {result.questions.map((question) => {
          const single = question.criteria.length === 1 ? question.criteria[0] : null
          const answer = question.answer
          const transcription = transcriptionDrafts[question.questionId] ?? answer?.transcription ?? ""
          const flags = result.questionFlags[question.questionId]
          // A practical part the AI held for the teacher (no AI marks on it).
          const heldForTeacher = Boolean(powerPoint) && answer?.status === "unreadable"
          return (
            <li
              key={question.questionId}
              className={`rounded-md border p-3 ${
                flags?.open ? "border-destructive/60" : question.awaitingCheck ? "border-amber-500/60" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-1 flex-wrap items-center gap-1">
                  <p className="text-sm font-semibold text-foreground">{question.label}</p>
                  <Badge variant="outline" className="text-[10px]">{MARKING_LABELS[question.marking]}</Badge>
                  {question.awaitingCheck ? (
                    <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">Check</Badge>
                  ) : null}
                  {flags?.open ? (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <Flag className="h-3 w-3" aria-hidden="true" />
                      Flagged by pupil
                    </Badge>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {question.awarded === null ? (
                    <Badge variant="outline" className="text-[10px]">Not marked</Badge>
                  ) : (
                    <ProvenanceBadge provenance={question.provenance} />
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {question.awarded ?? "—"} / {question.available}
                  </span>
                </div>
              </div>

              {question.dependsOnLabel ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Builds on question {question.dependsOnLabel}: the marker sees that answer too.
                </p>
              ) : null}
              {question.marking === "teacher" ? (
                <p className="mt-1 text-xs text-muted-foreground">Teacher only: not sent to the marker. Mark it below.</p>
              ) : !question.hasMarkScheme && answer && answer.status !== "blank" && question.awarded === null ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Not sent to the marker: this question has no mark scheme text. Add it in the lesson, or mark it below.
                </p>
              ) : null}

              {/* Question-marked types have no model answer: mark scheme, else the criteria. */}
              <MarkedAgainst
                markScheme={question.markScheme}
                criteria={question.criteria.map((c) => c.description)}
              />

              {flags?.open ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1">
                  <span className="text-xs text-muted-foreground">
                    The pupil asked you to check this mark ({formatDay(flags.open.flaggedAt)}).
                  </span>
                  <button
                    type="button"
                    disabled={isPending || !canMark}
                    onClick={() => clearFlag(question.questionId)}
                    className="rounded border border-destructive bg-destructive px-2 py-0.5 text-xs text-white disabled:opacity-50"
                  >
                    Clear flag
                  </button>
                </div>
              ) : null}
              {flags && flags.history.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {flags.history.map((entry) => (
                    <li key={entry.flagId}>{flagHistoryLine(entry)}</li>
                  ))}
                </ul>
              ) : null}

              {question.awaitingCheck ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1">
                  <span className="text-xs text-muted-foreground">
                    {heldForTeacher
                      ? "Held for you: the AI did not mark this part (the reason is under Evidence). Mark it yourself."
                      : powerPoint
                      ? "Set for you to check: confirm the AI's marks or change them."
                      : answer?.kind === "sketch"
                      ? "A sketch: check the AI's marks against the page."
                      : answer?.status === "unreadable"
                        ? "The reader could not read this answer: check the AI's marks against the page."
                        : "Set for you to check: confirm the AI's marks or change them."}
                  </span>
                  {heldForTeacher ? null : (
                    <button
                      type="button"
                      disabled={isPending || !canMark}
                      onClick={() => confirmQuestion(question.questionId)}
                      className="rounded border border-primary bg-primary px-2 py-0.5 text-xs text-primary-foreground disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  )}
                </div>
              ) : null}

              {powerPoint ? (
                <PowerPointAnswer
                  question={question}
                  transcription={transcription}
                  disabled={isPending || !canMark}
                  onDraft={(value) => setTranscriptionDrafts((prev) => ({ ...prev, [question.questionId]: value }))}
                  onSave={(value) => saveTranscription(question.questionId, value)}
                />
              ) : null}

              {answer && !powerPoint ? (
                <div className="mt-2 space-y-1">
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span>Pupil&apos;s answer:</span>
                    <span>{ANSWER_STATUS_LABELS[answer.status] ?? answer.status}</span>
                    {answer.kind !== "text" ? <span>· {answer.kind}</span> : null}
                    {answer.pages.length > 0 ? (
                      <span>
                        · page{answer.pages.length === 1 ? "" : "s"}{" "}
                        {answer.pages.map((pageNumber, index) => {
                          const page = result.script?.pages.find((p) => p.pageNumber === pageNumber)
                          return (
                            <span key={pageNumber}>
                              {index > 0 ? ", " : ""}
                              {page ? (
                                <a href={page.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                  {pageNumber}
                                </a>
                              ) : (
                                pageNumber
                              )}
                            </span>
                          )
                        })}
                      </span>
                    ) : null}
                    {answer.provenance === "teacher" ? (
                      <Badge variant="secondary" className="text-[10px]">Edited</Badge>
                    ) : null}
                  </div>
                  <textarea
                    value={transcription}
                    disabled={isPending || !canMark}
                    placeholder={answer.status === "blank" ? "No answer" : "What the pupil wrote"}
                    rows={Math.min(8, Math.max(2, transcription.split("\n").length))}
                    aria-label={`Transcription of question ${question.label}`}
                    onChange={(event) =>
                      setTranscriptionDrafts((prev) => ({ ...prev, [question.questionId]: event.target.value }))
                    }
                    onBlur={(event) => {
                      const next = event.target.value.trim()
                      if (next !== (answer.transcription ?? "")) saveTranscription(question.questionId, next)
                    }}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              ) : null}

              {single ? (
                // One criterion: the question's mark is that criterion's mark.
                <div className="mt-2">
                  <MarkButtons
                    max={single.allocation}
                    selected={selectedLevel(single)}
                    disabled={isPending || !canMark}
                    onSelect={(level) => setAwarded(question.questionId, single, level)}
                  />
                  {renderComment(question.questionId, single)}
                </div>
              ) : (
                <ul className="mt-2 space-y-2">
                  {question.criteria.map((criterion, index) => {
                    const key = `${question.questionId}|${criterion.successCriteriaId}`
                    return (
                      <li key={key} className="border-l-2 border-border pl-2">
                        <div className="flex items-start justify-between gap-2">
                          <MarkRowLabel
                            index={index}
                            count={question.criteria.length}
                            max={criterion.allocation}
                            description={criterion.description}
                          />
                          <div className="flex shrink-0 items-center gap-1">
                            {criterion.awarded !== null ? <ProvenanceBadge provenance={criterion.provenance} /> : null}
                            <span className="text-xs font-medium text-foreground">
                              {criterion.awarded ?? "—"} / {criterion.available}
                            </span>
                          </div>
                        </div>
                        <MarkButtons
                          max={criterion.allocation}
                          selected={selectedLevel(criterion)}
                          disabled={isPending || !canMark}
                          onSelect={(level) => setAwarded(question.questionId, criterion, level)}
                        />
                        {renderComment(question.questionId, criterion)}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * One practical task's evidence: what the reader found (a digest, or the
 * pupil's typed answer, which a teacher may correct when the task reads typed
 * text), the pictures and database report the marker was given, and the
 * marker's note.
 */
function PowerPointAnswer({
  question,
  transcription,
  disabled,
  onDraft,
  onSave,
}: {
  question: AssessmentResultQuestion
  transcription: string
  disabled: boolean
  onDraft: (value: string) => void
  onSave: (value: string) => void
}) {
  const answer = question.answer
  // Only a typed answer the reader found can be corrected; a blank or a digest
  // of other evidence is shown as it is.
  const editable =
    readsTypedText(question) && answer !== null && answer.kind === "text" && answer.status !== "blank"
  return (
    <div className="mt-2 space-y-1">
      {answer ? (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{editable ? "Pupil's typed answer:" : "Evidence:"}</span>
          <span>{ANSWER_STATUS_LABELS[answer.status] ?? answer.status}</span>
          {answer.provenance === "teacher" ? <Badge variant="secondary" className="text-[10px]">Edited</Badge> : null}
        </div>
      ) : question.marking !== "teacher" ? (
        <p className="text-xs text-muted-foreground">Not read yet.</p>
      ) : null}
      {editable ? (
        <textarea
          value={transcription}
          disabled={disabled}
          placeholder="What the pupil typed"
          rows={Math.min(8, Math.max(2, transcription.split("\n").length))}
          aria-label={`Typed answer for ${question.label}`}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={(event) => {
            const next = event.target.value.trim()
            if (next !== (answer.transcription ?? "")) onSave(next)
          }}
          className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      ) : answer?.transcription ? (
        <p className="whitespace-pre-line text-xs text-foreground">{answer.transcription}</p>
      ) : null}
      <EvidenceThumbnails images={question.evidenceImages} />
      <EvidenceTexts texts={question.evidenceTexts} />
      {question.markerEvidence ? <MarkerEvidenceNote text={question.markerEvidence} /> : null}
    </div>
  )
}
