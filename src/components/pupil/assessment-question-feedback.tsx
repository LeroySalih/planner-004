"use client"

import { useState, useTransition, type ReactNode } from "react"
import { Flag } from "lucide-react"
import { toast } from "sonner"

import type {
  PupilAssessmentCriterionComment,
  PupilAssessmentFeedback,
  PupilAssessmentQuestionFeedback,
} from "@/lib/assessment-paper/pupil-feedback"
import { setAssessmentQuestionFlagAction } from "@/lib/server-actions/assessment-paper-results"
import { cn } from "@/lib/utils"

const LINK_CLASS =
  "inline-flex min-h-11 items-center text-sm font-semibold text-la-green hover:text-la-green-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green"

/**
 * A question-marked activity's feedback on the pupil's lesson page, the same
 * for an assessment paper and a PowerPoint assessment: the total, the
 * teacher's comment, the feedback PDF (and `links`, the type's own), then
 * each question's mark and comments. `canFlag` (the pupil, lesson not
 * locked) adds a flag per marked question for their teacher to check;
 * teachers previewing never get it.
 */
export function AssessmentQuestionFeedback({
  feedback,
  canFlag,
  preview,
  links,
}: {
  feedback: PupilAssessmentFeedback
  canFlag: boolean
  /** A teacher previewing before feedback is released. */
  preview: boolean
  links?: ReactNode
}) {
  return (
    <section aria-label="Your feedback" className="space-y-3 rounded-[10px] border border-la-border bg-la-green-pale/60 p-4">
      {preview ? (
        <p className="text-sm font-semibold text-la-amber">Preview: pupils can&apos;t see this until you release feedback.</p>
      ) : null}
      <p className="font-semibold">
        {feedback.marksAwarded === null ? "Not marked yet" : `${feedback.marksAwarded} / ${feedback.maxMarks} marks`}
      </p>
      {feedback.teacherComment ? <p className="whitespace-pre-line">{feedback.teacherComment}</p> : null}
      {feedback.feedbackPdfUrl || links ? (
        <div className="flex flex-wrap gap-x-5">
          {feedback.feedbackPdfUrl ? (
            <a href={feedback.feedbackPdfUrl} className={LINK_CLASS}>
              Download your feedback (PDF)
            </a>
          ) : null}
          {links}
        </div>
      ) : null}
      <ol className="divide-y divide-la-border border-t border-la-border">
        {feedback.questions.map((question) => (
          <li key={question.questionId} className="py-3">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-semibold">
                {question.label}
                {question.questionText ? (
                  <span className="ml-2 font-normal text-la-muted">{question.questionText}</span>
                ) : null}
              </p>
              <span className="flex-none text-sm font-semibold">
                {question.awarded === null ? "Not marked" : `${question.awarded} / ${question.available}`}
              </span>
            </div>
            {question.comments.length > 0 ? (
              <ul className="mt-1 space-y-1 text-sm">
                {question.comments.map((comment, index) => (
                  <CommentLine key={index} comment={comment} />
                ))}
              </ul>
            ) : null}
            {canFlag && feedback.submissionId && question.awarded !== null ? (
              <QuestionFlag
                key={`${question.questionId}:${question.flag.open}:${question.flag.lastOutcome}`}
                submissionId={feedback.submissionId}
                question={question}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

function CommentLine({ comment }: { comment: PupilAssessmentCriterionComment }) {
  if (comment.source === "teacher") {
    return <li className="whitespace-pre-line">{comment.text}</li>
  }
  return (
    <li className="space-y-0.5">
      {comment.whyNotAwarded ? <p className="whitespace-pre-line">{comment.whyNotAwarded}</p> : null}
      {comment.howToImprove ? (
        <p className="whitespace-pre-line">
          <span className="font-semibold">To improve: </span>
          {comment.howToImprove}
        </p>
      ) : null}
    </li>
  )
}

/** The pupil asks their teacher to check this question's mark, or takes it back. */
function QuestionFlag({ submissionId, question }: { submissionId: string; question: PupilAssessmentQuestionFeedback }) {
  const [open, setOpen] = useState(question.flag.open)
  const [pending, startTransition] = useTransition()
  const checked = !open && question.flag.lastOutcome !== null

  const toggle = () => {
    const next = !open
    setOpen(next)
    startTransition(async () => {
      try {
        const result = await setAssessmentQuestionFlagAction({ submissionId, questionId: question.questionId, flagged: next })
        if (result.error) {
          setOpen(!next)
          toast.error("Unable to update the flag", { description: result.error })
        }
      } catch {
        setOpen(!next)
        toast.error("Unable to update the flag", { description: "Network error, please try again." })
      }
    })
  }

  return (
    <div className="mt-1">
      {checked ? <p className="text-sm text-la-muted">Your teacher checked this.</p> : null}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={open}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 text-sm",
          open ? "font-medium text-la-red" : "text-la-muted hover:text-la-ink",
        )}
      >
        <Flag className="h-4 w-4" aria-hidden="true" />
        {open ? "Flagged for your teacher. Unflag" : "Flag this mark for your teacher to check"}
      </button>
    </div>
  )
}
