import "server-only"

import { query, withDbClient } from "@/lib/db"
import { resolveQuestionModelRoute } from "@/lib/assessment-paper/question-model-route"
import { logQueueEvent } from "@/lib/ai/marking-log"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import {
  activityOf,
  batchParkHook,
  logIgnoredQuestionModel,
  logIgnoredTextAnswerRoute,
  recordCall,
  type AssessmentJob,
} from "@/lib/assessment-paper/jobs"
import { batchRecord, batchReply, type BatchJobResult } from "@/lib/ai/message-batches"
import type { ModelJsonCall } from "@/lib/assessment-paper/reading"
import {
  completeAssessmentQuestionMark,
  completeAssessmentRead,
  type AssessmentSubmissionTotals,
  type ReadCompletion,
} from "@/lib/assessment-paper/store"
import { finishPowerPointQuestionMark, markPowerPointQuestion, type PowerPointMarkContext } from "@/lib/powerpoint-assessment/marking"
import { readPowerPointSubmission, type PowerPointReaders } from "@/lib/powerpoint-assessment/reading"
import { isPracticalAssessmentType } from "@/dino.config"
import { practicalTypeConfig } from "@/lib/practical-assessment/types"

// The two queue jobs of a practical assessment (PowerPoint or database), as
// an assessment paper's:
//
//   ai_read  {submissionId, assignmentId}              one per hand-in; no model
//   ai_mark  {submissionId, assignmentId, questionId}  one per question to mark
//
// The read records what it read on its job row (files, durations, sections
// found; no base64), then either holds the whole submission (a file that
// cannot be read, a required file missing) or hands the answers to the store
// (completeAssessmentRead), which queues the marks. The queue worker
// (marking-queue.ts) claims the job and handles retries and failure.

/** "PowerPoint assessment" or "Database assessment", for the log; the type itself when it is not practical. */
function labelOf(type: string | null | undefined): string {
  return isPracticalAssessmentType(type) ? practicalTypeConfig(type).label : `${type ?? "Unknown"} activity`
}

/** The label of a submission's activity type, for the log. */
async function submissionLabel(submissionId: string): Promise<string> {
  const { rows } = await query<{ type: string | null }>(
    "select a.type from submissions s join activities a on a.activity_id = s.activity_id where s.submission_id = $1",
    [submissionId],
  )
  return rows[0] ? labelOf(rows[0].type) : "Practical assessment"
}

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
  const label = await submissionLabel(job.submissionId)
  await logQueueEvent("info", `Reading ${label} submission ${job.submissionId}`)
  const read = await readPowerPointSubmission({ submissionId: job.submissionId }, readers)
  await recordCall(job.jobId, read.call)

  if (read.held) {
    // mark_error is the teacher's and may name the pupil's files; the job
    // rows and the log get the reason without them.
    const jobReason = read.heldForLog ?? read.held
    const held = await holdSubmission(job, read.held, jobReason)
    await logQueueEvent("warn", `Held ${label} submission ${job.submissionId}`, { reason: jobReason, held })
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
  await logQueueEvent("info", `Read ${label} submission ${job.submissionId}`, {
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

/**
 * Mark one question of one hand-in and record it. With the route's batch
 * switch on, the request is parked for a Message Batch (the job stays
 * 'processing'); its result comes back as `options.batch` and goes through
 * the same reply handling and store.
 */
export async function runPowerPointMarkJob(
  job: AssessmentJob & { questionId: string },
  call?: ModelJsonCall,
  options: { batch?: BatchJobResult } = {},
): Promise<{ totals: AssessmentSubmissionTotals | null; complete: boolean; parked?: true }> {
  let marked: Awaited<ReturnType<typeof markPowerPointQuestion>>
  let label: string
  if (options.batch) {
    const context = options.batch.context as PowerPointMarkContext
    label = await submissionLabel(job.submissionId)
    marked = finishPowerPointQuestionMark(context, batchReply(options.batch, context.model))
    if (marked.call) marked.call.request.batch = batchRecord(options.batch)
  } else {
    const { activityId, type } = await activityOf(job.submissionId)
    // The question's own model, else the type's text-question route when the
    // question sends no pictures and that route has its own row (migration
    // 150), else the activity-wide route.
    const route = await resolveQuestionModelRoute(type, job.questionId)
    label = labelOf(type)
    await logIgnoredQuestionModel(route, job)
    await logIgnoredTextAnswerRoute(route, job)
    await logQueueEvent("info", `Marking ${label} submission ${job.submissionId}`, {
      questionId: job.questionId,
      provider: route.provider,
      model: route.model,
      modelSource: route.source,
      ...(route.useBatch ? { batch: true } : {}),
    })

    marked = await markPowerPointQuestion(
      {
        submissionId: job.submissionId,
        activityId,
        questionId: job.questionId,
        provider: route.provider,
        model: route.model,
        effort: route.effort,
      },
      call,
      { park: batchParkHook<PowerPointMarkContext>(route, job, "practical-mark", job.questionId) },
    )
  }
  if (marked.parked) {
    await logQueueEvent("info", `Parked question ${job.questionId} of ${label} submission ${job.submissionId} for a Message Batch`)
    return { totals: null, complete: false, parked: true }
  }
  if (marked.call?.request.reused) {
    await recordCall(job.jobId, marked.call)
    await logQueueEvent("info", `Reused the stored mark: question ${job.questionId} of ${label} submission ${job.submissionId}`, {
      questionId: job.questionId,
      held: Boolean(marked.hold),
      marksAwarded: marked.call.response.marksAwarded,
      maxMarks: marked.call.request.maxMarks,
    })
  } else if (marked.call && marked.hold) {
    await recordCall(job.jobId, marked.call)
    await logQueueEvent("info", `Held for the teacher: question ${job.questionId} of ${label} submission ${job.submissionId}`, {
      questionId: job.questionId,
      durationMs: marked.call.durationMs,
    })
  } else if (marked.call) {
    await recordCall(job.jobId, marked.call)
    await logQueueEvent("info", `Marked ${label} submission ${job.submissionId}`, {
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
    ...(marked.hold ? { hold: { questionId: job.questionId, reason: marked.hold } } : {}),
    markRequest: marked.markRequest ?? null,
  })
}
