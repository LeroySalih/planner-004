import "server-only"

import { query, withDbClient } from "@/lib/db"
import { resolveModelRoute } from "@/lib/ai/model-routing"
import { logQueueEvent } from "@/lib/ai/marking-log"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import { activityOf, recordCall, type AssessmentJob } from "@/lib/assessment-paper/jobs"
import type { ModelJsonCall } from "@/lib/assessment-paper/reading"
import {
  completeAssessmentQuestionMark,
  completeAssessmentRead,
  type AssessmentSubmissionTotals,
  type ReadCompletion,
} from "@/lib/assessment-paper/store"
import { markPowerPointQuestion } from "@/lib/powerpoint-assessment/marking"
import { readPowerPointSubmission, type PowerPointReaders } from "@/lib/powerpoint-assessment/reading"

// The two queue jobs of a PowerPoint assessment, as an assessment paper's:
//
//   ai_read  {submissionId, assignmentId}              one per hand-in; no model
//   ai_mark  {submissionId, assignmentId, questionId}  one per question to mark
//
// The read records what it read on its job row (files, durations, sections
// found; no base64), then either holds the whole submission (a file that
// cannot be read, a required file missing) or hands the answers to the store
// (completeAssessmentRead), which queues the marks. The queue worker
// (marking-queue.ts) claims the job and handles retries and failure.

/**
 * Hold the submission: the read job (if still this run's) and any other open
 * job are closed with `jobReason`, mark_status is null and mark_error says
 * why (`reason`). A job no longer 'processing' was replaced by a newer hand-in, which is
 * left alone. Returns whether it held.
 */
async function holdSubmission(job: AssessmentJob, reason: string, jobReason: string): Promise<boolean> {
  return withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      await client.query("select 1 from submissions where submission_id = $1 for update", [job.submissionId])
      const { rows } = await client.query(
        `update external_jobs set status = 'error', last_error = $2, updated_at = now()
          where job_id = $1 and status = 'processing'
          returning job_id`,
        [job.jobId, jobReason],
      )
      if (rows.length === 0) {
        await client.query("COMMIT")
        return false
      }
      await client.query(
        `update external_jobs set status = 'error', last_error = $2, updated_at = now()
          where job_type in ('ai_read', 'ai_mark') and status in ('pending', 'processing')
            and payload->>'submissionId' = $1`,
        [job.submissionId, jobReason],
      )
      await client.query("update submissions set mark_status = null, mark_error = $2 where submission_id = $1", [
        job.submissionId,
        reason,
      ])
      await client.query("COMMIT")
      return true
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  })
}

/** Read one hand-in's files, store what was read, and queue the questions to mark (or hold it). */
export async function runPowerPointReadJob(
  job: AssessmentJob,
  readers?: PowerPointReaders,
): Promise<ReadCompletion & { held: string | null }> {
  await logQueueEvent("info", `Reading PowerPoint assessment submission ${job.submissionId}`)
  const read = await readPowerPointSubmission({ submissionId: job.submissionId }, readers)
  await recordCall(job.jobId, read.call)

  if (read.held) {
    // mark_error is the teacher's and may name the pupil's files; the job
    // rows and the log get the reason without them.
    const jobReason = read.heldForLog ?? read.held
    const held = await holdSubmission(job, read.held, jobReason)
    await logQueueEvent("warn", `Held PowerPoint assessment submission ${job.submissionId}`, { reason: jobReason, held })
    if (held) {
      const { rows } = await query<{ activity_id: string; user_id: string }>(
        "select activity_id, user_id from submissions where submission_id = $1",
        [job.submissionId],
      )
      void emitSubmissionEvent("submission.updated", {
        submissionId: job.submissionId,
        activityId: rows[0]?.activity_id ?? "",
        pupilId: rows[0]?.user_id ?? "",
        markStatus: null,
        markError: read.held,
      })
    }
    return {
      queuedQuestionIds: [],
      blankQuestionIds: [],
      teacherQuestionIds: [],
      heldQuestionIds: [],
      totals: null,
      complete: false,
      held: read.held,
    }
  }

  const outcome = await completeAssessmentRead({
    submissionId: job.submissionId,
    assignmentId: job.assignmentId,
    jobId: job.jobId,
    answers: read.answers,
  })
  await logQueueEvent("info", `Read PowerPoint assessment submission ${job.submissionId}`, {
    files: read.call.request.files.length,
    cached: read.call.request.files.filter((file) => file.cached).length,
    durationMs: read.call.durationMs,
    queued: outcome.queuedQuestionIds.length,
    blank: outcome.blankQuestionIds.length,
    teacherOnly: outcome.teacherQuestionIds.length,
    held: outcome.heldQuestionIds.length,
  })
  return { ...outcome, held: null }
}

/** Mark one question of one hand-in and record it. */
export async function runPowerPointMarkJob(
  job: AssessmentJob & { questionId: string },
  call?: ModelJsonCall,
): Promise<{ totals: AssessmentSubmissionTotals | null; complete: boolean }> {
  const { activityId, type } = await activityOf(job.submissionId)
  const route = await resolveModelRoute(type, null)
  await logQueueEvent("info", `Marking PowerPoint assessment submission ${job.submissionId}`, {
    questionId: job.questionId,
    provider: route.provider,
    model: route.model,
  })

  const marked = await markPowerPointQuestion(
    { submissionId: job.submissionId, activityId, questionId: job.questionId, provider: route.provider, model: route.model },
    call,
  )
  if (marked.call) {
    await recordCall(job.jobId, marked.call)
    await logQueueEvent("info", `Marked PowerPoint assessment submission ${job.submissionId}`, {
      questionId: job.questionId,
      marksAwarded: marked.call.response.marksAwarded,
      maxMarks: marked.call.request.maxMarks,
      attachments: marked.call.request.attachments.length,
      durationMs: marked.call.durationMs,
    })
  } else {
    await logQueueEvent("info", `Not marked: question ${job.questionId} of submission ${job.submissionId} (${marked.skipped})`)
  }
  return completeAssessmentQuestionMark({
    submissionId: job.submissionId,
    jobId: job.jobId,
    rows: marked.rows,
    ...(marked.call ? { markerEvidence: { questionId: job.questionId, text: marked.evidenceNote } } : {}),
  })
}
