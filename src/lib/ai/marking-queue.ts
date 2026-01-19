import { query, withDbClient } from "@/lib/db";
import {
  ShortTextActivityBodySchema,
  ShortTextSubmissionBodySchema,
} from "@/types";
import { invokeDoAiMarking } from "./do-ai-marking";

export async function logQueueEvent(
  level: "info" | "warn" | "error",
  message: string,
  metadata: any = {},
) {
  await query(
    `INSERT INTO ai_marking_logs (level, message, metadata) VALUES ($1, $2, $3)`,
    [level, message, JSON.stringify(metadata)],
  );
}

export async function enqueueMarkingTasks(
  assignmentId: string,
  tasks: Array<{ submissionId: string }>,
) {
  if (tasks.length === 0) return;

  await logQueueEvent(
    "info",
    `Enqueueing ${tasks.length} tasks for assignment ${assignmentId}`,
  );

  // Build bulk insert
  // We use ON CONFLICT DO NOTHING because of the unique index on submission_id for active tasks
  const values = tasks.map((_, i) =>
    `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
  ).join(", ");
  const params = tasks.flatMap(
    (t) => [t.submissionId, assignmentId, "pending"],
  );

  await query(
    `
    INSERT INTO ai_marking_queue (submission_id, assignment_id, status)
    VALUES ${values}
    ON CONFLICT (submission_id) WHERE status IN ('pending', 'processing') DO NOTHING
    `,
    params,
  );
}

export async function processNextQueueItem() {
  const secret = process.env.MARKING_QUEUE_SECRET;
  const callbackUrl = process.env.AI_MARKING_CALLBACK_URL;
  const BATCH_SIZE = 5;

  // 1. Claim a batch of rows
  // We use the global query pool directly so we don't lock a single client for the duration
  const { rows } = await query(
    `
    UPDATE ai_marking_queue
    SET status = 'processing',
        attempts = attempts + 1,
        updated_at = now()
    WHERE queue_id IN (
      SELECT queue_id
      FROM ai_marking_queue
      WHERE status = 'pending'
        AND attempts < 3
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING queue_id, submission_id, assignment_id, attempts
    `,
    [BATCH_SIZE],
  );

  if (rows.length === 0) {
    return { processed: 0, remaining: 0 };
  }

  await logQueueEvent(
    "info",
    `Claimed batch of ${rows.length} items for processing`,
  );

  // 2. Process in parallel
  const results = await Promise.allSettled(
    rows.map((item) => processSingleItem(item, callbackUrl)),
  );

  // 3. Check remaining
  const { rows: countRows } = await query(
    "SELECT count(*) FROM ai_marking_queue WHERE status = 'pending' AND attempts < 3",
  );
  const remainingCount = parseInt(countRows[0].count, 10);

  if (remainingCount === 0) {
    await logQueueEvent(
      "info",
      "Queue processing complete (no remaining pending items)",
    );
  }

  // Count successfully processed items (fulfilled promises)
  const processedCount = results.filter((r) => r.status === "fulfilled").length;

  return { processed: processedCount, remaining: remainingCount };
}

async function processSingleItem(
  item: {
    queue_id: string;
    submission_id: string;
    assignment_id: string;
    attempts: number;
  },
  callbackUrl?: string,
) {
  try {
    await logQueueEvent(
      "info",
      `Processing item ${item.queue_id} for submission ${item.submission_id} (Attempt ${item.attempts})`,
    );

    // 2. Fetch context for DO function
    // Use global query for parallel safety
    const { rows: contextRows } = await query(
      `
        SELECT 
          s.body as submission_body,
          s.user_id as pupil_id,
          a.body_data as activity_body,
          a.activity_id,
          a.type
        FROM submissions s
        JOIN activities a ON a.activity_id = s.activity_id
        WHERE s.submission_id = $1
        LIMIT 1
        `,
      [item.submission_id],
    );

    let context = contextRows[0];

    // Fallback: Check revision_answers if not found in submissions
    if (!context) {
      const { rows: revisionRows } = await query(
        `
          SELECT 
            ra.answer_data as submission_body,
            r.pupil_id as pupil_id,
            a.body_data as activity_body,
            a.activity_id,
            a.type
          FROM revision_answers ra
          JOIN revisions r ON r.revision_id = ra.revision_id
          JOIN activities a ON a.activity_id = ra.activity_id
          WHERE ra.answer_id = $1
          LIMIT 1
          `,
        [item.submission_id], // We queue answer_id as submission_id
      );
      context = revisionRows[0];
    }
    if (!context) {
      throw new Error("Submission or activity context missing");
    }

    // Guard: Only process short-text questions
    if (context.type !== "short-text-question") {
      await logQueueEvent(
        "warn",
        `Skipping non-short-text activity ${context.activity_id}`,
        { type: context.type },
      );

      // Mark as completed so we don't retry
      await query(
        `UPDATE ai_marking_queue SET status = 'completed', updated_at = now() WHERE queue_id = $1`,
        [item.queue_id],
      );
      return;
    }

    const parsedActivity = ShortTextActivityBodySchema.parse(
      context.activity_body,
    );
    const parsedSubmission = ShortTextSubmissionBodySchema.parse(
      context.submission_body,
    );

    // 3. Trigger DO function
    let effectiveCallbackUrl: string | undefined;

    if (callbackUrl) {
      // Normalize base URL (remove trailing slash)
      const normalizedBase = callbackUrl.replace(/\/$/, "");

      if (item.assignment_id === "revision") {
        effectiveCallbackUrl = `${normalizedBase}/webhooks/ai-mark-revision`;
      } else {
        effectiveCallbackUrl = `${normalizedBase}/webhooks/ai-mark`;
      }
    }

    // We pass the webhook info to DO
    const doParams = {
      question: parsedActivity.question,
      model_answer: parsedActivity.modelAnswer,
      pupil_answer: parsedSubmission.answer || "",
      webhook_url: effectiveCallbackUrl,
      group_assignment_id: item.assignment_id,
      activity_id: context.activity_id,
      pupil_id: context.pupil_id,
      submission_id: item.submission_id,
    };

    await logQueueEvent(
      "info",
      `Triggering DO function for submission ${item.submission_id}`,
      doParams,
    );

    await invokeDoAiMarking(doParams);

    // Note: We don't mark as 'completed' here.
    // The webhook callback will do that.
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[marking-queue] Failed to process item ${item.queue_id}:`,
      error,
    );
    await logQueueEvent("error", `Failed to process item ${item.queue_id}`, {
      error: errorMessage,
    });

    await query(
      `
        UPDATE ai_marking_queue
        SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
            last_error = $1,
            updated_at = now()
        WHERE queue_id = $2
        `,
      [errorMessage, item.queue_id],
    );
    // Re-throw to signal failure to Promise.allSettled (optional, but good for counting stats)
    throw error;
  }
}

export async function resolveQueueItem(submissionId: string) {
  await query(
    `UPDATE ai_marking_queue SET status = 'completed', updated_at = now() WHERE submission_id = $1`,
    [submissionId],
  );
}

export async function triggerQueueProcessor(baseUrl?: string) {
  const secret = process.env.MARKING_QUEUE_SECRET;
  if (!secret) {
    console.error("[marking-queue] MARKING_QUEUE_SECRET not configured");
    return;
  }

  // Use provided baseUrl or fallback to env var
  let effectiveBaseUrl = baseUrl;
  if (!effectiveBaseUrl && process.env.AI_MARKING_CALLBACK_URL) {
    effectiveBaseUrl = process.env.AI_MARKING_CALLBACK_URL.replace(/\/$/, "");
  }

  if (!effectiveBaseUrl) {
    console.error("[marking-queue] No base URL available to trigger processor");
    return;
  }

  // Note: triggerQueueProcessor calls our INTERNAL API route, not the webhook.
  // The internal API route is likely /api/marking/process-queue (found in file list earlier)
  const url = `${effectiveBaseUrl}/api/marking/process-queue`;
  console.log(`[marking-queue] Triggering processor at: ${url}`);

  // Fire and forget
  void fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
    },
  }).catch((err) => console.error("[marking-queue] Trigger failed:", err));
}

export async function pruneCompletedQueueItems() {
  await query(
    `DELETE FROM ai_marking_queue WHERE status = 'completed' AND updated_at < now() - interval '7 days'`,
  );
}

export async function recoverStuckItems() {
  await query(
    `
    UPDATE ai_marking_queue
    SET status = 'pending',
        last_error = 'Recovered from stuck processing state'
    WHERE status = 'processing'
      AND updated_at < now() - interval '10 minutes'
    `,
  );
}
