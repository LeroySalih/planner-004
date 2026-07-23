"use server";

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  logQueueEvent,
  processNextQueueItem,
  triggerQueueProcessor,
} from "@/lib/ai/marking-queue";

export async function readAiMarkingQueueAction() {
  try {
    const { rows } = await query(
      `
      SELECT
        q.job_id as queue_id,
        q.payload->>'submissionId' as submission_id,
        q.payload->>'assignmentId' as assignment_id,
        q.status,
        q.attempts,
        q.last_error,
        q.process_after,
        q.created_at,
        q.updated_at,
        COALESCE(p.first_name, rp.first_name) as first_name,
        COALESCE(p.last_name, rp.last_name) as last_name,
        COALESCE(a.title, ra_act.title) as activity_title,
        CASE WHEN q.payload->>'assignmentId' = 'revision' THEN 'Revision' ELSE 'Lesson' END as source_type,
        s.mark_status,
        s.mark_error
      FROM external_jobs q
      -- Regular submissions
      LEFT JOIN submissions s ON s.submission_id = q.payload->>'submissionId' AND q.payload->>'assignmentId' != 'revision'
      LEFT JOIN profiles p ON p.user_id = s.user_id
      LEFT JOIN activities a ON a.activity_id = s.activity_id

      -- Revision answers
      LEFT JOIN revision_answers ra ON ra.answer_id::text = q.payload->>'submissionId' AND q.payload->>'assignmentId' = 'revision'
      LEFT JOIN revisions r ON r.revision_id = ra.revision_id
      LEFT JOIN profiles rp ON rp.user_id = r.pupil_id
      LEFT JOIN activities ra_act ON ra_act.activity_id = ra.activity_id

      WHERE q.job_type = 'ai_mark'
      ORDER BY q.process_after ASC
      LIMIT 100
      `,
    );

    const statsResult = await query(
      `
      SELECT
        (
          select count(*) from external_jobs q
          left join submissions s on s.submission_id = q.payload->>'submissionId'
          left join revision_answers r on q.payload->>'assignmentId' = 'revision' and r.answer_id = (q.payload->>'submissionId')::uuid
          where q.job_type = 'ai_mark' and (s.mark_status = 'waiting' or r.status = 'pending_marking')
        ) as waiting,
        (
          select count(*) from external_jobs q
          left join submissions s on s.submission_id = q.payload->>'submissionId'
          left join revision_answers r on q.payload->>'assignmentId' = 'revision' and r.answer_id = (q.payload->>'submissionId')::uuid
          where q.job_type = 'ai_mark' and (s.mark_status = 'marking' or r.status = 'marking')
        ) as marking,
        (select count(*) from external_jobs where job_type = 'ai_mark') as total
      `,
    );

    return {
      success: true,
      data: rows,
      stats: statsResult.rows[0],
    };
  } catch (error) {
    console.error("[ai-queue] Failed to read queue:", error);
    return { success: false, error: "Failed to load queue data." };
  }
}

export async function retryQueueItemAction(queueId: string) {
  try {
    await query(
      `UPDATE external_jobs SET status = 'pending', attempts = 0, process_after = now(), updated_at = now() WHERE job_id = $1`,
      [queueId],
    );
    // Reset linked submission back to waiting state
    await query(
      `UPDATE submissions SET mark_status = 'waiting'
       WHERE submission_id = (SELECT payload->>'submissionId' FROM external_jobs WHERE job_id = $1)`,
      [queueId],
    );
    // Reset linked revision answer back to pending_marking (no-op for non-revision rows)
    await query(
      `UPDATE revision_answers SET status = 'pending_marking'
       WHERE answer_id = (
         SELECT (payload->>'submissionId')::uuid FROM external_jobs
         WHERE job_id = $1 AND payload->>'assignmentId' = 'revision'
       )`,
      [queueId],
    );
    void triggerQueueProcessor();
    revalidatePath("/ai-queue");
    return { success: true };
  } catch (error) {
    console.error("[ai-queue] Failed to retry item:", error);
    return { success: false, error: "Failed to retry item." };
  }
}

export async function processQueueAction() {
  try {
    await logQueueEvent("info", "Manual process trigger received");
    // Process one item immediately in this request to guarantee some activity
    const result = await processNextQueueItem();
    await logQueueEvent(
      "info",
      `Manual trigger result: ${JSON.stringify(result)}`,
    );

    // If there's more, trigger the background processor
    if (result.remaining > 0) {
      void triggerQueueProcessor();
    }

    revalidatePath("/ai-queue");
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ai-queue] Failed to trigger processor:", error);
    await logQueueEvent("error", "Manual process trigger failed", {
      error: msg,
    });
    return { success: false };
  }
}

export async function readAiMarkingLogsAction() {
  try {
    const { rows } = await query(
      `SELECT log_id, level, message, metadata, created_at::text as created_at FROM ai_marking_logs ORDER BY created_at DESC LIMIT 100`,
    );
    console.log("[ai-queue] readAiMarkingLogsAction rows found:", rows.length);
    if (rows.length > 0) {
      console.log(
        "[ai-queue] First log sample:",
        JSON.stringify(rows[0], null, 2),
      );
    }
    return { success: true, data: rows };
  } catch (error) {
    console.error("[ai-queue] Failed to read logs:", error);
    return { success: false, error: "Failed to load logs." };
  }
}

export async function clearAiMarkingQueueAction() {
  try {
    await query(`DELETE FROM external_jobs WHERE job_type = 'ai_mark'`);
    await logQueueEvent("info", "Queue manually cleared");
    revalidatePath("/ai-queue");
    return { success: true };
  } catch (error) {
    console.error("[ai-queue] Failed to clear queue:", error);
    return { success: false, error: "Failed to clear queue." };
  }
}

export async function clearAiMarkingLogsAction() {
  try {
    await query(`DELETE FROM ai_marking_logs`);
    revalidatePath("/ai-queue");
    return { success: true };
  } catch (error) {
    console.error("[ai-queue] Failed to clear logs:", error);
    return { success: false, error: "Failed to clear logs." };
  }
}
