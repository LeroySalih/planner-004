import "server-only"

import { query } from "@/lib/db"
import { resolveModelRoute } from "@/lib/ai/model-routing"
import { logQueueEvent } from "@/lib/ai/marking-log"
import {
  completeAssessmentQuestionMark,
  completeAssessmentRead,
  type AssessmentSubmissionTotals,
  type ReadCompletion,
} from "@/lib/assessment-paper/store"
import { readAssessmentScript, type ModelJsonCall } from "@/lib/assessment-paper/reading"
import { PermanentAssessmentMarkingError, markAssessmentQuestion } from "@/lib/assessment-paper/marking"

// The two queue jobs of an assessment paper (Marking v2):
//
//   ai_read  {submissionId, assignmentId}              one per script
//   ai_mark  {submissionId, assignmentId, questionId}  one per question to mark
//
// Each runs its model call, records the call on its job row (no base64), then
// hands the result to the store, which writes it, closes the job and marks the
// submission when no sibling job is open, all under the submission's row lock.
// The queue worker (marking-queue.ts) claims the job, sets it 'processing',
// and handles retries and failure; these run only the work. `call` is the
// model call, stubbed in tests.

/** Surface key of the read in ai_model_routes (migration 135). */
export const ASSESSMENT_READ_SURFACE = "surface:assessment-read"

export interface AssessmentJob {
  jobId: string
  submissionId: string
  assignmentId: string
}

/** Record a job's call (or, for a read with no model, what it read) on its row. No base64. */
export async function recordCall(jobId: string, call: { request: unknown; response: unknown; durationMs: number }) {
  await query(
    `update external_jobs
        set model_request = $2::jsonb, model_response = $3::jsonb, duration_ms = $4, updated_at = now()
      where job_id = $1`,
    [jobId, JSON.stringify(call.request), JSON.stringify(call.response), call.durationMs],
  )
}

/** The submission's activity and its type: the type is the mark's route key in ai_model_routes. */
export async function activityOf(submissionId: string): Promise<{ activityId: string; type: string }> {
  const { rows } = await query<{ activity_id: string; type: string }>(
    `select s.activity_id, a.type
       from submissions s join activities a on a.activity_id = s.activity_id
      where s.submission_id = $1`,
    [submissionId],
  )
  if (!rows[0]) throw new PermanentAssessmentMarkingError(`Submission ${submissionId} not found.`)
  return { activityId: rows[0].activity_id, type: rows[0].type }
}

/** Read one script, store its answers, and queue the questions to mark. */
export async function runAssessmentReadJob(job: AssessmentJob, call?: ModelJsonCall): Promise<ReadCompletion> {
  const { activityId } = await activityOf(job.submissionId)
  const route = await resolveModelRoute(ASSESSMENT_READ_SURFACE, null)
  await logQueueEvent("info", `Reading assessment paper submission ${job.submissionId}`, {
    provider: route.provider,
    model: route.model,
  })

  const read = await readAssessmentScript(
    { submissionId: job.submissionId, activityId, provider: route.provider, model: route.model },
    call,
  )
  await recordCall(job.jobId, read.call)

  const outcome = await completeAssessmentRead({
    submissionId: job.submissionId,
    assignmentId: job.assignmentId,
    jobId: job.jobId,
    answers: read.answers,
  })
  await logQueueEvent("info", `Read assessment paper submission ${job.submissionId}`, {
    pages: read.call.request.pages.length,
    durationMs: read.call.durationMs,
    queued: outcome.queuedQuestionIds.length,
    blank: outcome.blankQuestionIds.length,
    teacherOnly: outcome.teacherQuestionIds.length,
    held: outcome.heldQuestionIds.length,
  })
  return outcome
}

/** Mark one question of one script and record it. */
export async function runAssessmentMarkJob(
  job: AssessmentJob & { questionId: string },
  call?: ModelJsonCall,
): Promise<{ totals: AssessmentSubmissionTotals | null; complete: boolean }> {
  const { activityId, type } = await activityOf(job.submissionId)
  // Allocations, not the criterion's own type, set the marks on a paper, so
  // the activity-wide route of the activity's own type applies.
  const route = await resolveModelRoute(type, null)
  await logQueueEvent("info", `Marking assessment paper submission ${job.submissionId}`, {
    questionId: job.questionId,
    provider: route.provider,
    model: route.model,
  })

  const marked = await markAssessmentQuestion(
    {
      submissionId: job.submissionId,
      activityId,
      questionId: job.questionId,
      provider: route.provider,
      model: route.model,
    },
    call,
  )
  if (marked.call) {
    await recordCall(job.jobId, marked.call)
    await logQueueEvent("info", `Marked assessment paper submission ${job.submissionId}`, {
      questionId: job.questionId,
      marksAwarded: marked.call.response.marksAwarded,
      maxMarks: marked.call.request.maxMarks,
      pages: marked.call.request.images.length,
      durationMs: marked.call.durationMs,
    })
  } else {
    await logQueueEvent("info", `Not marked: question ${job.questionId} of submission ${job.submissionId} (${marked.skipped})`)
  }

  return completeAssessmentQuestionMark({ submissionId: job.submissionId, jobId: job.jobId, rows: marked.rows })
}
