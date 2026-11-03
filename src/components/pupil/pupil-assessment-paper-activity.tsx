"use client"

import { useEffect, useState } from "react"

import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"
import type { PupilAssessmentPaperView } from "@/lib/assessment-paper/results"
import { readMyAssessmentPaperViewAction } from "@/lib/server-actions/assessment-paper-results"

interface PupilAssessmentPaperActivityProps {
  activityId: string
  pupilId: string
  viewerIsTeacher: boolean
  /** Loaded on the server; its feedback only when already visible to the viewer. */
  initialView: PupilAssessmentPaperView
}

const LINK_CLASS =
  "inline-flex min-h-11 items-center text-sm font-semibold text-la-green hover:text-la-green-hover"

/**
 * An assessment paper on the pupil's lesson page. Pupils do not answer it
 * here: their teacher uploads the script. Until then only the activity's
 * title shows, so the paper cannot be read before the test. Once the script
 * is uploaded the question paper is linked; once the lesson's feedback is
 * released, the overall marks, the teacher's overall comment, the feedback
 * PDF and their own script. The
 * question-by-question detail is in the PDF.
 */
export function PupilAssessmentPaperActivity({
  activityId,
  pupilId,
  viewerIsTeacher,
  initialView,
}: PupilAssessmentPaperActivityProps) {
  const { currentVisible } = useFeedbackVisibility()
  const visible = currentVisible || viewerIsTeacher
  const [view, setView] = useState<PupilAssessmentPaperView>(initialView)
  const [loading, setLoading] = useState(false)

  // Released while the page is open: fetch the marks now. The server checks again.
  useEffect(() => {
    if (!visible || !view.sat || view.feedback) return
    let cancelled = false
    setLoading(true)
    readMyAssessmentPaperViewAction(activityId, pupilId)
      .then((result) => {
        if (!cancelled && result.data) setView(result.data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible, view.sat, view.feedback, activityId, pupilId])

  if (!view.sat) return null

  const feedback = visible ? view.feedback : null

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-la-ink">
      {view.questionPaperUrl ? (
        <a href={view.questionPaperUrl} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          Question paper
        </a>
      ) : null}

      {loading && !feedback ? <p className="text-sm text-la-muted">Loading your marks…</p> : null}

      {feedback ? (
        <div className="space-y-2 rounded-[10px] border border-la-border bg-la-green-pale/60 p-4">
          {viewerIsTeacher && !currentVisible ? (
            <p className="text-sm font-semibold text-la-amber">
              Preview: pupils can&apos;t see this until you release feedback.
            </p>
          ) : null}
          <p className="font-semibold">
            {feedback.marksAwarded === null
              ? "Not marked yet"
              : `${feedback.marksAwarded} / ${feedback.maxMarks} marks`}
          </p>
          {feedback.teacherComment ? (
            <p className="whitespace-pre-line">{feedback.teacherComment}</p>
          ) : null}
          <div className="flex flex-wrap gap-x-5">
            <a href={feedback.feedbackPdfUrl} className={LINK_CLASS}>
              Download feedback
            </a>
            {feedback.scriptUrl ? (
              <a href={feedback.scriptUrl} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                My script
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
