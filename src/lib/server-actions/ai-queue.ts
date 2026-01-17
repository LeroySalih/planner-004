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
        q.*,
        COALESCE(p.first_name, rp.first_name) as first_name,
        COALESCE(p.last_name, rp.last_name) as last_name,
        COALESCE(a.title, ra_act.title) as activity_title,
        CASE WHEN q.assignment_id = 'revision' THEN 'Revision' ELSE 'Lesson' END as source_type
      FROM ai_marking_queue q
      -- Regular submissions
      LEFT JOIN submissions s ON s.submission_id = q.submission_id AND q.assignment_id != 'revision'
      LEFT JOIN profiles p ON p.user_id = s.user_id
      LEFT JOIN activities a ON a.activity_id = s.activity_id

      -- Revision answers
      LEFT JOIN revision_answers ra ON ra.answer_id::text = q.submission_id AND q.assignment_id = 'revision'
      LEFT JOIN revisions r ON r.revision_id = ra.revision_id
      LEFT JOIN profiles rp ON rp.user_id = r.pupil_id
      LEFT JOIN activities ra_act ON ra_act.activity_id = ra.activity_id
      
      ORDER BY q.created_at DESC
      LIMIT 100
      `,
    );

    const statsResult = await query(
      `
      SELECT 
        count(*) filter (where status = 'pending') as pending,
        count(*) filter (where status = 'processing') as processing,
        count(*) filter (where status = 'completed') as completed,
        count(*) filter (where status = 'failed') as failed
      FROM ai_marking_queue
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
      `UPDATE ai_marking_queue SET status = 'pending', attempts = 0 WHERE queue_id = $1`,
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
    await query(`DELETE FROM ai_marking_queue`);
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
