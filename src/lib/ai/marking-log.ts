import "server-only"

import { query } from "@/lib/db"

/**
 * Append to the marking audit log.
 *
 * Lives in its own module so the apply layer can log without importing the
 * queue: the queue now calls the apply functions directly (no webhook hop), and
 * a mutual import would be a cycle.
 */
export async function logQueueEvent(
  level: "info" | "warn" | "error",
  message: string,
  metadata: unknown = {},
) {
  await query(
    `INSERT INTO ai_marking_logs (level, message, metadata) VALUES ($1, $2, $3)`,
    [level, message, JSON.stringify(metadata)],
  )
}
