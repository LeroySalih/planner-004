import "server-only";

import { query } from "@/lib/db";

/**
 * Generalized external-service job queue.
 *
 * Every interaction with an external service (Gotenberg conversion, n8n
 * marking) and the processing of inbound webhook responses is enqueued here so
 * it is tracked, retryable and observable through a single pathway.
 *
 * Handlers are dispatched by `job_type`. A handler receives the job row and
 * returns an arbitrary JSON-serialisable result (stored in `result`). Throwing
 * marks the job failed and schedules a retry until `max_attempts` is reached.
 */

export type ExternalJobType = "doc_convert" | "webhook_apply";

export type ExternalJob = {
  job_id: string;
  job_type: ExternalJobType;
  status: "pending" | "processing" | "done" | "error";
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

const RETRY_BACKOFF_SECONDS = 30;
const STUCK_JOB_MINUTES = 10;
const BATCH_SIZE = 5;

/** Enqueue a new external-service job. Returns the new job_id. */
export async function enqueueJob(
  jobType: ExternalJobType,
  payload: Record<string, unknown>,
  options?: { processAfterSeconds?: number; maxAttempts?: number },
): Promise<string> {
  const delaySecs = options?.processAfterSeconds ?? 0;
  const maxAttempts = options?.maxAttempts ?? 3;

  const { rows } = await query<{ job_id: string }>(
    `
      insert into external_jobs (job_type, payload, max_attempts, process_after)
      values ($1, $2::jsonb, $3, now() + make_interval(secs => $4))
      returning job_id
    `,
    [jobType, JSON.stringify(payload), maxAttempts, delaySecs],
  );
  return rows[0].job_id;
}

/** Dispatch a job to its handler by job_type. */
async function dispatchJob(job: ExternalJob): Promise<unknown> {
  switch (job.job_type) {
    case "doc_convert": {
      const { handleDocConvert } = await import("./handlers/doc-convert");
      return handleDocConvert(job);
    }
    case "webhook_apply": {
      const { handleWebhookApply } = await import("./handlers/webhook-apply");
      return handleWebhookApply(job);
    }
    default:
      throw new Error(`Unknown external job type: ${(job as ExternalJob).job_type}`);
  }
}

async function finishJob(jobId: string, result: unknown): Promise<void> {
  await query(
    `update external_jobs set status='done', result=$2::jsonb, updated_at=now() where job_id=$1`,
    [jobId, JSON.stringify(result ?? null)],
  );
}

async function failJob(job: ExternalJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const attemptsNow = job.attempts + 1;

  if (attemptsNow >= job.max_attempts) {
    await query(
      `update external_jobs set status='error', attempts=$2, last_error=$3, updated_at=now() where job_id=$1`,
      [job.job_id, attemptsNow, message],
    );
  } else {
    // Back off and return to the pending pool for another attempt.
    await query(
      `update external_jobs
         set status='pending',
             attempts=$2,
             last_error=$3,
             process_after = now() + make_interval(secs => $4),
             updated_at=now()
       where job_id=$1`,
      [job.job_id, attemptsNow, message, RETRY_BACKOFF_SECONDS],
    );
  }
}

/** Claim, run and finalise a batch of runnable jobs. */
export async function processNextJobs(): Promise<{ processed: number; remaining: number }> {
  const { rows: claimed } = await query<ExternalJob>(
    `
      update external_jobs j
      set status='processing', updated_at=now()
      from (
        select job_id
        from external_jobs
        where status='pending' and process_after <= now() and attempts < max_attempts
        order by process_after asc
        limit $1
        for update skip locked
      ) picked
      where j.job_id = picked.job_id
      returning j.job_id, j.job_type, j.status, j.payload, j.attempts, j.max_attempts
    `,
    [BATCH_SIZE],
  );

  if (claimed.length === 0) {
    return { processed: 0, remaining: 0 };
  }

  const results = await Promise.allSettled(
    claimed.map(async (job) => {
      try {
        const result = await dispatchJob(job);
        await finishJob(job.job_id, result);
      } catch (error) {
        console.error(`[external-jobs] Job ${job.job_id} (${job.job_type}) failed:`, error);
        await failJob(job, error);
        throw error;
      }
    }),
  );

  const processed = results.filter((r) => r.status === "fulfilled").length;

  const { rows: countRows } = await query<{ count: string }>(
    `select count(*)::text as count from external_jobs where status='pending' and process_after <= now() and attempts < max_attempts`,
  );
  const remaining = parseInt(countRows[0]?.count ?? "0", 10);

  return { processed, remaining };
}

/** Return jobs stuck in 'processing' (e.g. crashed mid-run) to the pending pool. */
export async function recoverStuckJobs(): Promise<void> {
  await query(
    `update external_jobs
       set status='pending', updated_at=now()
     where status='processing' and updated_at < now() - make_interval(mins => $1)`,
    [STUCK_JOB_MINUTES],
  );
}

/** Prune old completed jobs so the table stays small. Keeps errors for review. */
export async function pruneDoneJobs(): Promise<void> {
  await query(
    `delete from external_jobs where status='done' and updated_at < now() - interval '7 days'`,
  );
}

/**
 * Kick the processor via its internal API route (fire-and-forget). Mirrors the
 * marking-queue trigger; reuses MARKING_QUEUE_SECRET for auth.
 */
export async function triggerJobProcessor(baseUrl?: string): Promise<void> {
  const secret = process.env.MARKING_QUEUE_SECRET;
  if (!secret) {
    console.warn("[external-jobs] MARKING_QUEUE_SECRET not set; cannot trigger processor");
    return;
  }
  const effectiveBaseUrl = baseUrl
    ?? (process.env.AI_MARKING_CALLBACK_URL
      ? new URL(process.env.AI_MARKING_CALLBACK_URL).origin
      : undefined);
  if (!effectiveBaseUrl) {
    console.warn("[external-jobs] No base URL to trigger processor");
    return;
  }
  void fetch(`${effectiveBaseUrl}/api/jobs/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch((err) => console.error("[external-jobs] Failed to trigger processor:", err));
}
