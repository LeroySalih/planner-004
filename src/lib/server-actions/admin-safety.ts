"use server";

import { query } from "@/lib/db";
import { type SafetyLogEntry, SafetyLogEntrySchema } from "@/types";

export async function getFlaggedSubmissionsAction() {
  try {
    const { rows } = await query(
      `
      SELECT 
        sl.safety_log_id,
        sl.created_at,
        sl.ai_model_feedback,
        sl.prompt,
        a.activity_id,
        a.title as activity_title,
        p.user_id as pupil_id,
        p.first_name as pupil_first_name,
        p.last_name as pupil_last_name,
        p.email as pupil_email
      FROM safety_logs sl
      LEFT JOIN activities a ON sl.activity_id = a.activity_id
      LEFT JOIN profiles p ON sl.user_id = p.user_id
      ORDER BY sl.created_at DESC
      LIMIT 100
      `,
    );

    console.log(
      `[getFlaggedSubmissionsAction] Found ${rows.length} safety log rows`,
    );

    const logs = rows.map((row) => SafetyLogEntrySchema.parse(row));
    return { success: true, data: logs as SafetyLogEntry[] };
  } catch (error: any) {
    console.error("Failed to fetch safety logs", error);
    return { success: false, error: error.message };
  }
}
