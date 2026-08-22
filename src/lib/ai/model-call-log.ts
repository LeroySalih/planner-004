import "server-only"

import { query } from "@/lib/db"

/**
 * Record a model call that has already happened.
 *
 * Marking calls are already reviewable — they run through the queue, so their
 * request, response and duration land on the `external_jobs` row that drove
 * them (migration 085). Chat calls are synchronous and left no trace at all,
 * which is exactly the gap that hurt when a valid lesson-chat reply was
 * rejected in production: there was a stack trace and no way to look at the
 * reply that caused it.
 *
 * These rows share `external_jobs` rather than getting their own table so
 * there is one place to look for "what did we send a model, and what came
 * back". They are log entries, not work:
 *
 *  - Written with `status = 'done'` even when the call failed. The queue claims
 *    `status = 'pending'` and `job_type = 'ai_mark'`, so a done chat row is
 *    doubly unclaimable — and `pruneDoneJobs` only sweeps 'done', so writing
 *    failures as 'error' would leave them accumulating forever. Success and
 *    failure are distinguished by `last_error`, not by status.
 *  - Never retried: `attempts`/`max_attempts` are meaningless here.
 *
 * Writing is fire-and-forget and never throws. Losing a log line must not take
 * down the surface being logged.
 */

/** Long enough to diagnose, short enough not to bloat a row. */
const TEXT_LIMIT = 4_000

function truncate(value: string | null | undefined): { text: string; chars: number } | null {
  if (typeof value !== "string") return null
  return { text: value.slice(0, TEXT_LIMIT), chars: value.length }
}

export interface ModelCallRecord {
  /** The surface key from MODEL_SURFACES, e.g. "surface:lesson-chat". */
  surface: string
  provider: string
  model: string
  /** System text is the injected lesson/unit context and can be very large. */
  system?: string | null
  userMessage: string
  historyTurns: number
  /**
   * Attachment metadata only — never the bytes. A chat turn can carry several
   * megabytes of base64, and the same reasoning applies here as to the image
   * payloads deliberately excluded from marking records.
   */
  attachments?: Array<{ fileName: string; kind: string }>
  response?: {
    message?: string | null
    proposalCount?: number
    /** The model's reply verbatim — the thing that was missing during the incident. */
    raw?: string | null
  } | null
  durationMs?: number | null
  /** Set when the call, or a check applied to its reply, failed. */
  error?: string | null
  /** Anything that identifies what was being worked on (lessonId, unitId). */
  context?: Record<string, unknown>
}

export async function recordModelCall(entry: ModelCallRecord): Promise<void> {
  try {
    await query(
      `insert into external_jobs
         (job_type, status, payload, model_request, model_response, duration_ms, last_error)
       values ('chat', 'done', $1::jsonb, $2::jsonb, $3::jsonb, $4, $5)`,
      [
        JSON.stringify({ surface: entry.surface, ...(entry.context ?? {}) }),
        JSON.stringify({
          provider: entry.provider,
          model: entry.model,
          surface: entry.surface,
          system: truncate(entry.system),
          userMessage: truncate(entry.userMessage),
          historyTurns: entry.historyTurns,
          attachments: entry.attachments ?? [],
        }),
        entry.response
          ? JSON.stringify({
              message: truncate(entry.response.message),
              proposalCount: entry.response.proposalCount ?? 0,
              raw: truncate(entry.response.raw),
            })
          : null,
        entry.durationMs ?? null,
        entry.error ?? null,
      ],
    )
  } catch (err) {
    console.error("[model-call-log] Failed to record call:", err)
  }
}
