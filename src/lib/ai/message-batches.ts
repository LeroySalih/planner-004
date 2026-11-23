import "server-only"

import { createHash } from "node:crypto"

import type Anthropic from "@anthropic-ai/sdk"

import { query, withDbClient } from "@/lib/db"
import { anthropicClient, buildClaudeMessageParams, claudeReplyText } from "@/lib/ai/anthropic-client"
import { claudeRequestOf, parseModelJson, type ModelRequest } from "@/lib/ai/model-client"
import { logQueueEvent } from "@/lib/ai/marking-log"
import { anthropicUsage, type ModelUsage } from "@/lib/ai/model-usage"

// Message Batches for question marking (migration 152): half the price of a
// direct call, results within 24 hours.
//
// Only a question-marked type's per-question ai_mark and an assessment
// paper's ai_read go this way, and only when the route that chose the model
// has its batch switch on (BATCH_ROUTE_KEYS, model-routing.ts). The marker
// prepares its request exactly as for a direct call (mark reuse first: a
// reused mark is never parked) and, instead of calling, parks it here:
//
//   park    the full Messages API body (buildClaudeMessageParams, cache flags
//           kept) and the reply handler's context in model_batch_items. The
//           job stays 'processing': the claim takes only 'pending' jobs, and
//           recoverStuckItems skips a job with an item. So a re-mark, Undo
//           hand in, a file change or a hold drops or closes a parked job as
//           it does a running one.
//   submit  every parked item, each tick, in Message Batches of at most
//           MAX_BATCH_REQUESTS requests and MAX_BATCH_BYTES; custom_id is the
//           job id (a uuid fits ^[a-zA-Z0-9_-]{1,64}$).
//   poll    each open batch at most once per POLL_INTERVAL_SECONDS; once it
//           has ended, each result goes to the queue's handler (succeeded:
//           the marker's own reply handling and apply), or the job goes back
//           to the direct path (errored, expired, canceled). A result whose
//           item or job has gone, or whose job is no longer 'processing', is
//           dropped, as a stale direct reply is.
//
// A job that leaves a batch carries payload.directOnly, so a retry of it is
// a direct call, never another batch. The tick (runBatchTick, marking-queue.ts)
// is run by the batch driver (batch-driver.ts) about once a minute while any
// batch work is open.

/** The kind of a parked job, for its item row. */
export type BatchItemKind = "assessment-mark" | "practical-mark" | "assessment-read"

/** The API's limits on one Message Batch. */
export const MAX_BATCH_REQUESTS = 100_000
export const MAX_BATCH_BYTES = 256 * 1024 * 1024
/** Room left under MAX_BATCH_BYTES for the request envelope. */
const BATCH_BYTES_MARGIN = 4 * 1024 * 1024

/** An open batch is polled no more often than this. */
export const POLL_INTERVAL_SECONDS = 55
/** A parked item not submitted after this long (the API refused every try) goes back to the direct path. */
export const UNSUBMITTED_LIMIT_MINUTES = 30
/** A submitted item with no result after this long (a batch expires at 24 h) goes back to the direct path. */
export const SUBMITTED_LIMIT_HOURS = 25

const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/

/** A parked job's result, as the queue hands it to the job's runner. */
export interface BatchJobResult {
  batch: { id: string; submittedAt: string }
  /** What the marker's reply handler needs (its prepared context), as parked. */
  context: unknown
  message: Anthropic.Message
}

/** A batch result as a reply: the same shape as callModelJson's, so it goes through the same handling. Throws as a direct reply would. */
export function batchReply(result: BatchJobResult, model: string): {
  data: unknown
  raw: string
  durationMs: number
  attempts: number
  usage: ModelUsage | null
} {
  const raw = claudeReplyText(result.message, model)
  return {
    data: parseModelJson(raw, model),
    raw,
    durationMs: Math.max(0, Date.now() - Date.parse(result.batch.submittedAt)),
    attempts: 1,
    usage: anthropicUsage(result.message.usage),
  }
}

/** The job row's record of the batch it went by. */
export function batchRecord(result: BatchJobResult): { id: string; submittedAt: string } {
  return { id: result.batch.id, submittedAt: result.batch.submittedAt }
}

/**
 * Park a claimed job's prepared request for the next batch. Returns false,
 * and parks nothing, when the job is no longer 'processing' or must go
 * directly (payload.directOnly: it came back from a batch). Anthropic only.
 */
export async function parkForBatch(input: {
  jobId: string
  kind: BatchItemKind
  submissionId: string
  questionId: string | null
  /** The mark-reuse fingerprint; for a read, a hash of the body. */
  requestHash?: string
  request: ModelRequest
  context: unknown
}): Promise<boolean> {
  if (input.request.provider !== "anthropic") return false
  const body = buildClaudeMessageParams(claudeRequestOf(input.request))
  const bodyText = JSON.stringify(body)
  const requestHash = input.requestHash ?? createHash("sha256").update(bodyText).digest("hex")
  const { rows } = await query<{ job_id: string }>(
    `insert into model_batch_items (job_id, kind, submission_id, question_id, request_hash, body, context)
     select j.job_id, $2, $3, $4::uuid, $5, $6::jsonb, $7::jsonb
       from external_jobs j
      where j.job_id = $1::uuid and j.status = 'processing'
        and coalesce((j.payload->>'directOnly')::boolean, false) = false
     on conflict (job_id) do update
       set kind = excluded.kind, request_hash = excluded.request_hash, body = excluded.body,
           context = excluded.context, batch_id = null, submitted_at = null, created_at = now()
     returning job_id`,
    [input.jobId, input.kind, input.submissionId, input.questionId, requestHash, bodyText, JSON.stringify(input.context ?? null)],
  )
  if (rows.length === 0) return false
  await query(
    `update external_jobs
        set model_request = $2::jsonb, model_response = null, updated_at = now()
      where job_id = $1::uuid`,
    [
      input.jobId,
      JSON.stringify({
        provider: input.request.provider,
        model: input.request.model ?? null,
        requestHash,
        batch: { id: null, submittedAt: null },
      }),
    ],
  )
  return true
}

/** Whether any batch work is open: a parked item, or a batch whose results are not yet handled. */
export async function hasOpenBatchWork(): Promise<boolean> {
  const { rows } = await query<{ open: boolean }>(
    `select exists (select 1 from model_batch_items)
         or exists (select 1 from model_batches where results_handled_at is null) as open`,
  )
  return Boolean(rows[0]?.open)
}

/**
 * Send jobs back to the direct path: 'pending' now, payload.directOnly set,
 * the reason in last_error, attempts unchanged (the model never answered),
 * their items removed. Only jobs still 'processing'. Returns how many.
 */
export async function releaseToDirect(jobIds: string[], reason: string): Promise<number> {
  if (jobIds.length === 0) return 0
  const { rows } = await query<{ submission_id: string }>(
    `update external_jobs
        set status = 'pending', process_after = now(), last_error = $2,
            payload = payload || '{"directOnly": true}'::jsonb, updated_at = now()
      where job_id = any($1::uuid[]) and status = 'processing'
      returning payload->>'submissionId' as submission_id`,
    [jobIds, reason],
  )
  await query("delete from model_batch_items where job_id = any($1::uuid[])", [jobIds])
  if (rows.length > 0) {
    await query(
      "update submissions set mark_status = 'waiting' where submission_id = any($1::text[]) and mark_status = 'marking'",
      [Array.from(new Set(rows.map((row) => row.submission_id)))],
    )
  }
  return rows.length
}

/** Items left too long: never submitted, or submitted with no result in time. Back to the direct path. */
export async function releaseOverdueBatchItems(): Promise<number> {
  const { rows } = await query<{ job_id: string; submitted: boolean }>(
    `select job_id::text, batch_id is not null as submitted from model_batch_items
      where (batch_id is null and created_at < now() - make_interval(mins => $1))
         or (batch_id is not null and submitted_at < now() - make_interval(hours => $2))`,
    [UNSUBMITTED_LIMIT_MINUTES, SUBMITTED_LIMIT_HOURS],
  )
  const unsent = rows.filter((row) => !row.submitted).map((row) => row.job_id)
  const late = rows.filter((row) => row.submitted).map((row) => row.job_id)
  const released =
    (await releaseToDirect(unsent, `Could not be sent by batch in ${UNSUBMITTED_LIMIT_MINUTES} minutes; sent directly.`)) +
    (await releaseToDirect(late, `No batch result in ${SUBMITTED_LIMIT_HOURS} hours; sent directly.`))
  if (rows.length > 0) await logQueueEvent("warn", `Released ${rows.length} overdue batch items to the direct path`, { released })
  return released
}

/**
 * Submit the parked items, oldest first, as one Message Batch within the
 * API's limits. Returns the batch id and how many went (0 and null when none
 * were parked). The items stay locked while the batch is created, so another
 * worker cannot send them twice; a failed create leaves them parked for the
 * next tick.
 */
export async function submitParkedBatchItems(): Promise<{ batchId: string | null; submitted: number }> {
  return withDbClient(async (client) => {
    await client.query("BEGIN")
    try {
      const { rows: parked } = await client.query<{ job_id: string; bytes: number }>(
        `select job_id::text, octet_length(body::text)::int as bytes from model_batch_items
          where batch_id is null
          order by created_at, job_id
          limit $1
          for update skip locked`,
        [MAX_BATCH_REQUESTS],
      )
      const chosen: string[] = []
      let bytes = 0
      for (const item of parked) {
        if (chosen.length > 0 && bytes + item.bytes > MAX_BATCH_BYTES - BATCH_BYTES_MARGIN) break
        chosen.push(item.job_id)
        bytes += item.bytes
      }
      if (chosen.length === 0) {
        await client.query("COMMIT")
        return { batchId: null, submitted: 0 }
      }
      const { rows: bodies } = await client.query<{ job_id: string; body: Anthropic.MessageCreateParamsNonStreaming }>(
        "select job_id::text, body from model_batch_items where job_id = any($1::uuid[]) order by created_at, job_id",
        [chosen],
      )
      const requests = bodies.filter((row) => CUSTOM_ID.test(row.job_id)).map((row) => ({ custom_id: row.job_id, params: row.body }))
      const batch = await anthropicClient().messages.batches.create({ requests })
      const ids = requests.map((request) => request.custom_id)
      await client.query(
        "insert into model_batches (batch_id, request_count, processing_status) values ($1, $2, $3)",
        [batch.id, ids.length, batch.processing_status],
      )
      const { rows: [{ submitted_at }] } = await client.query<{ submitted_at: string }>(
        `update model_batch_items set batch_id = $1, submitted_at = now() where job_id = any($2::uuid[])
         returning to_char(submitted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as submitted_at`,
        [batch.id, ids],
      )
      await client.query(
        `update external_jobs
            set model_request = jsonb_set(coalesce(model_request, '{}'::jsonb), '{batch}',
                                          jsonb_build_object('id', $1::text, 'submittedAt', $3::text)),
                updated_at = now()
          where job_id = any($2::uuid[])`,
        [batch.id, ids, submitted_at],
      )
      await client.query("COMMIT")
      await logQueueEvent("info", `Submitted Message Batch ${batch.id}`, { requests: ids.length, bytes })
      return { batchId: batch.id, submitted: ids.length }
    } catch (error) {
      await client.query("ROLLBACK")
      await logQueueEvent("error", "Could not submit a Message Batch; the items stay parked", {
        error: error instanceof Error ? error.message : String(error),
      })
      return { batchId: null, submitted: 0 }
    }
  })
}

/** A parked job whose result has come back, claimed for its handler. */
export type ReturnedBatchJob = {
  job_id: string
  job_type: string
  submission_id: string
  assignment_id: string
  question_id: string | null
  success_criteria_id: string | null
  attempts: number
}

/**
 * Poll the open batches that are due (POLL_INTERVAL_SECONDS); for each that
 * has ended, hand every result to `handle` (succeeded) or send its job back
 * to the direct path (errored, expired, canceled). Returns how many results
 * were handled or released. A result whose item has gone (the job was
 * deleted), or whose job is no longer 'processing', is dropped.
 */
export async function pollOpenBatches(
  handle: (job: ReturnedBatchJob, result: BatchJobResult) => Promise<void>,
): Promise<{ handled: number; released: number; dropped: number }> {
  const { rows: due } = await query<{ batch_id: string }>(
    `update model_batches set last_polled_at = now()
      where batch_id in (
        select batch_id from model_batches
         where results_handled_at is null
           and (last_polled_at is null or last_polled_at < now() - make_interval(secs => $1))
         for update skip locked)
      returning batch_id`,
    [POLL_INTERVAL_SECONDS],
  )
  const counts = { handled: 0, released: 0, dropped: 0 }
  if (due.length === 0) return counts
  const client = anthropicClient()

  for (const { batch_id: batchId } of due) {
    let batch: Anthropic.Messages.MessageBatch
    try {
      batch = await client.messages.batches.retrieve(batchId)
    } catch (error) {
      await logQueueEvent("warn", `Could not poll Message Batch ${batchId}`, { error: error instanceof Error ? error.message : String(error) })
      continue
    }
    await query(
      "update model_batches set processing_status = $2, ended_at = $3::timestamptz where batch_id = $1",
      [batchId, batch.processing_status, batch.ended_at],
    )
    if (batch.processing_status !== "ended") continue

    try {
      for await (const line of await client.messages.batches.results(batchId)) {
        const outcome = await handleResult(batchId, line, handle)
        counts[outcome] += 1
      }
    } catch (error) {
      // The rest are read again at the next poll: handled items are gone, so nothing is applied twice.
      await logQueueEvent("warn", `Could not read the results of Message Batch ${batchId}`, {
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    // An item the results did not name is not lost: it goes directly.
    const { rows: left } = await query<{ job_id: string }>(
      "select job_id::text from model_batch_items where batch_id = $1",
      [batchId],
    )
    counts.released += await releaseToDirect(left.map((row) => row.job_id), `Message Batch ${batchId} returned no result; sent directly.`)
    await query("update model_batches set results_handled_at = now() where batch_id = $1", [batchId])
    await logQueueEvent("info", `Handled the results of Message Batch ${batchId}`, { ...counts })
  }
  return counts
}

async function handleResult(
  batchId: string,
  line: Anthropic.Messages.MessageBatchIndividualResponse,
  handle: (job: ReturnedBatchJob, result: BatchJobResult) => Promise<void>,
): Promise<"handled" | "released" | "dropped"> {
  if (!CUSTOM_ID.test(line.custom_id) || !/^[0-9a-f-]{36}$/i.test(line.custom_id)) return "dropped"
  // Claim the item: one handler per result, however many workers poll.
  const { rows: items } = await query<{ context: unknown; submitted_at: string }>(
    `delete from model_batch_items where job_id = $1::uuid and batch_id = $2
     returning context, to_char(submitted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as submitted_at`,
    [line.custom_id, batchId],
  )
  const item = items[0]
  if (!item) {
    await logQueueEvent("info", `Dropped a Message Batch result: job ${line.custom_id} has gone`, { batchId })
    return "dropped"
  }
  if (line.result.type !== "succeeded") {
    const detail = line.result.type === "errored" ? `: ${line.result.error?.error?.message ?? "error"}` : ""
    const released = await releaseToDirect([line.custom_id], `Message Batch request ${line.result.type}${detail}; sent directly.`)
    return released > 0 ? "released" : "dropped"
  }
  const { rows: jobs } = await query<ReturnedBatchJob>(
    `update external_jobs set payload = payload || '{"directOnly": true}'::jsonb, updated_at = now()
      where job_id = $1::uuid and status = 'processing'
      returning job_id::text, job_type, payload->>'submissionId' as submission_id,
                payload->>'assignmentId' as assignment_id, payload->>'questionId' as question_id,
                payload->>'successCriteriaId' as success_criteria_id, attempts`,
    [line.custom_id],
  )
  if (!jobs[0]) {
    await logQueueEvent("info", `Dropped a Message Batch result: job ${line.custom_id} is no longer running`, { batchId })
    return "dropped"
  }
  await handle(jobs[0], { batch: { id: batchId, submittedAt: item.submitted_at }, context: item.context, message: line.result.message })
  return "handled"
}
