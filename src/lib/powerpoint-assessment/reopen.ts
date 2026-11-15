import "server-only"

import { resolveAssessmentQuestionFlags } from "@/lib/assessment-paper/question-flags"
import { reopenPowerPointAssessment } from "@/lib/powerpoint-assessment/files"
import { emitSubmissionEvent } from "@/lib/sse/topics"

/**
 * A teacher undoes a pupil's hand-in (Undo hand in, or Request
 * Resubmission): the work is reopened, and its open question flags are
 * cleared as that teacher, since the marks they were about are gone.
 */
export async function reopenPowerPointAssessmentForTeacher(activityId: string, pupilId: string, teacherId: string) {
  const result = await reopenPowerPointAssessment(activityId, pupilId)
  if (result.reopened && result.submissionId) {
    const resolved = await resolveAssessmentQuestionFlags(result.submissionId, teacherId)
    void emitSubmissionEvent("submission.updated", {
      submissionId: result.submissionId,
      activityId: resolved.activityId,
      pupilId: resolved.pupilId,
      submittedAt: resolved.submittedAt,
      body: resolved.body,
      isFlagged: resolved.isFlagged,
    })
  }
  return result
}
