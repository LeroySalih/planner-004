"use server"

import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { triggerQueueProcessor } from "@/lib/ai/marking-queue";

export async function readAiMarkingQueueAction() {
  try {
    const { rows } = await query(
      `
      SELECT 
        q.*,
        p.first_name,
        p.last_name,
        a.title as activity_title
      FROM ai_marking_queue q
      JOIN submissions s ON s.submission_id = q.submission_id
      JOIN profiles p ON p.user_id = s.user_id
      JOIN activities a ON a.activity_id = s.activity_id
      ORDER BY q.created_at DESC
      LIMIT 100
      `
    );

    const statsResult = await query(
      `
      SELECT 
        count(*) filter (where status = 'pending') as pending,
        count(*) filter (where status = 'processing') as processing,
        count(*) filter (where status = 'completed') as completed,
        count(*) filter (where status = 'failed') as failed
      FROM ai_marking_queue
      `
    );

    return {
      success: true,
      data: rows,
      stats: statsResult.rows[0]
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
      [queueId]
    );
    void triggerQueueProcessor();
    revalidatePath("/ai-queue");
    return { success: true };
  } catch (error) {
    console.error("[ai-queue] Failed to retry item:", error);
    return { success: false, error: "Failed to retry item." };
  }
}
