"use client"

import { useEffect, useState } from "react"

import { useFeedbackVisibility } from "@/app/pupil-lessons/[pupilId]/lessons/[lessonId]/feedback-visibility-debug"
import { AssessmentQuestionFeedback } from "@/components/pupil/assessment-question-feedback"
import type { PupilAssessmentPaperView } from "@/lib/assessment-paper/pupil-feedback"
import { readMyAssessmentPaperViewAction } from "@/lib/server-actions/assessment-paper-results"

interface PupilAssessmentPaperActivityProps {
  activityId: string
  pupilId: string
  viewerIsTeacher: boolean
  /** The viewer is this pupil and the lesson is not locked: they may flag a question. */
  canWork: boolean
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
 * released, their marks question by question (AssessmentQuestionFeedback,
 * as on a PowerPoint assessment), the feedback PDF and their own script.
 */
export function PupilAssessmentPaperActivity({
  activityId,
  pupilId,
  viewerIsTeacher,
  canWork,
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

      {loading && !feedback ? <p className="text-sm text-la-muted">Loading your feedback…</p> : null}

      {feedback ? (
        <AssessmentQuestionFeedback
          feedback={feedback}
          canFlag={canWork && !viewerIsTeacher}
          preview={viewerIsTeacher && !currentVisible}
          links={
            view.scriptUrl ? (
              <a href={view.scriptUrl} target="_blank" rel="noreferrer" className={LINK_CLASS}>
                My script
              </a>
            ) : null
          }
        />
      ) : null}
    </div>
  )
}
