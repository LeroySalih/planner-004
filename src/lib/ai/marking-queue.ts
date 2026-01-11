import { query, withDbClient } from "@/lib/db";
import { ShortTextSubmissionBodySchema, ShortTextActivityBodySchema } from "@/types";
import { invokeDoAiMarking } from "./do-ai-marking";

export async function logQueueEvent(level: 'info' | 'warn' | 'error', message: string, metadata: any = {}) {
  await query(
    `INSERT INTO ai_marking_logs (level, message, metadata) VALUES ($1, $2, $3)`,
    [level, message, JSON.stringify(metadata)]
  );
}

export async function enqueueMarkingTasks(
  assignmentId: string,
  tasks: Array<{ submissionId: string }>
) {
  if (tasks.length === 0) return;

  await logQueueEvent('info', `Enqueueing ${tasks.length} tasks for assignment ${assignmentId}`);

  // Build bulk insert
  // We use ON CONFLICT DO NOTHING because of the unique index on submission_id for active tasks
  const values = tasks.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(", ");
  const params = tasks.flatMap(t => [t.submissionId, assignmentId, 'pending']);

  await query(
    `
    INSERT INTO ai_marking_queue (submission_id, assignment_id, status)
    VALUES ${values}
    ON CONFLICT (submission_id) WHERE status IN ('pending', 'processing') DO NOTHING
    `,
    params
  );
}

export async function processNextQueueItem() {
  const secret = process.env.MARKING_QUEUE_SECRET;
  const callbackUrl = process.env.AI_MARKING_CALLBACK_URL;

  return await withDbClient(async (client) => {
    // 1. Claim exactly one row
    const { rows } = await client.query(
      `
      UPDATE ai_marking_queue
      SET status = 'processing',
          attempts = attempts + 1,
          updated_at = now()
      WHERE queue_id = (
        SELECT queue_id
        FROM ai_marking_queue
        WHERE status = 'pending'
          AND attempts < 3
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING queue_id, submission_id, assignment_id, attempts
      `
    );

    const item = rows[0];
    if (!item) {
      return { processed: false, remaining: 0 };
    }

    await logQueueEvent('info', `Claimed item ${item.queue_id} for submission ${item.submission_id} (Attempt ${item.attempts})`);

    try {
      // 2. Fetch context for DO function
      const { rows: contextRows } = await client.query(
        `
        SELECT 
          s.body as submission_body,
          s.user_id as pupil_id,
          a.body_data as activity_body,
          a.activity_id
        FROM submissions s
        JOIN activities a ON a.activity_id = s.activity_id
        WHERE s.submission_id = $1
        LIMIT 1
        `,
        [item.submission_id]
      );

      const context = contextRows[0];
      if (!context) {
        throw new Error("Submission or activity context missing");
      }

      const parsedActivity = ShortTextActivityBodySchema.parse(context.activity_body);
      const parsedSubmission = ShortTextSubmissionBodySchema.parse(context.submission_body);

      // 3. Trigger DO function (Fire and Forget if it supports webhook)
      // We pass the webhook info to DO
      await logQueueEvent('info', `Triggering DO function for submission ${item.submission_id}`);
      await invokeDoAiMarking({
        question: parsedActivity.question,
        model_answer: parsedActivity.modelAnswer,
        pupil_answer: parsedSubmission.answer || "",
        // Custom params for the DO function to know where to send results
        // @ts-ignore - adding extra params for the upgraded DO function
        webhook_url: callbackUrl,
        group_assignment_id: item.assignment_id,
        activity_id: context.activity_id,
        pupil_id: context.pupil_id,
        submission_id: item.submission_id
      });

      // Note: We don't mark as 'completed' here. 
      // The webhook callback will do that.
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[marking-queue] Failed to process item ${item.queue_id}:`, error);
      await logQueueEvent('error', `Failed to process item ${item.queue_id}`, { error: errorMessage });
      
      await client.query(
        `
        UPDATE ai_marking_queue
        SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
            last_error = $1,
            updated_at = now()
        WHERE queue_id = $2
        `,
        [errorMessage, item.queue_id]
      );
    }

    // 4. Check if more work remains
    const { count } = (await client.query(
      "SELECT count(*) FROM ai_marking_queue WHERE status = 'pending' AND attempts < 3"
    )).rows[0];

    const remainingCount = parseInt(count, 10);
    if (remainingCount === 0) {
      await logQueueEvent('info', 'Queue processing complete (no remaining pending items)');
    }

    return { processed: true, remaining: remainingCount };
  });
}

export async function resolveQueueItem(submissionId: string) {
  await query(
    `UPDATE ai_marking_queue SET status = 'completed', updated_at = now() WHERE submission_id = $1`,
    [submissionId]
  );
}

export async function triggerQueueProcessor(baseUrl?: string) {
  const secret = process.env.MARKING_QUEUE_SECRET;
  if (!secret) {
    console.error("[marking-queue] MARKING_QUEUE_SECRET not configured");
    return;
  }

  let effectiveBaseUrl = baseUrl;
  if (!effectiveBaseUrl && process.env.AI_MARKING_CALLBACK_URL) {
    try {
      effectiveBaseUrl = new URL(process.env.AI_MARKING_CALLBACK_URL).origin;
    } catch (e) {
      console.error("[marking-queue] Invalid AI_MARKING_CALLBACK_URL", e);
    }
  }

  if (!effectiveBaseUrl) {
    console.error("[marking-queue] No base URL available to trigger processor");
    return;
  }

  const url = `${effectiveBaseUrl}/api/marking/process-queue`;
  
  // Fire and forget
  void fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secret}`,
    }
  }).catch(err => console.error("[marking-queue] Trigger failed:", err));
}

export async function pruneCompletedQueueItems() {
  await query(
    `DELETE FROM ai_marking_queue WHERE status = 'completed' AND updated_at < now() - interval '7 days'`
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
    `
  );
}
