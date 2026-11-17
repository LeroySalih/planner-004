import "server-only"

import { query } from "@/lib/db"

// Manual backups requested on /admin/backups (migration 145). The app only
// records a request; scripts/backup-on-request.sh, run by the prod host's cron
// every minute, takes the backup, sends it to the dev server and writes the
// outcome back.

export type BackupRequestStatus = "pending" | "running" | "done" | "error"

export type BackupFile = { name: string; bytes: number }

export type BackupRequest = {
  requestId: string
  requestedBy: string
  requestedByName: string
  requestedAt: string
  status: BackupRequestStatus
  startedAt: string | null
  finishedAt: string | null
  files: BackupFile[]
  error: string | null
  /** Still pending after STALE_AFTER_MINUTES: the cron job is probably not installed. */
  stale: boolean
}

export const STALE_AFTER_MINUTES = 10

type Row = {
  request_id: string
  requested_by: string
  requested_by_name: string | null
  requested_at: Date | string
  status: BackupRequestStatus
  started_at: Date | string | null
  finished_at: Date | string | null
  files: unknown
  error: string | null
  stale: boolean
}

const toIso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null)

function toFiles(value: unknown): BackupFile[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((file) =>
    file && typeof file.name === "string" && typeof file.bytes === "number"
      ? [{ name: file.name, bytes: file.bytes }]
      : [],
  )
}

/** The newest requests first. */
export async function readBackupRequests(limit = 10): Promise<BackupRequest[]> {
  const { rows } = await query<Row>(
    `select b.request_id, b.requested_by, b.requested_at, b.status, b.started_at, b.finished_at, b.files, b.error,
            nullif(trim(concat(p.first_name, ' ', p.last_name)), '') as requested_by_name,
            (b.status = 'pending' and b.requested_at < now() - make_interval(mins => $2)) as stale
       from backup_requests b
       left join profiles p on p.user_id = b.requested_by
      order by b.requested_at desc
      limit $1`,
    [limit, STALE_AFTER_MINUTES],
  )
  return rows.map((row) => ({
    requestId: row.request_id,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? row.requested_by,
    requestedAt: new Date(row.requested_at).toISOString(),
    status: row.status,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    files: toFiles(row.files),
    error: row.error,
    stale: row.stale,
  }))
}

export class BackupAlreadyRequestedError extends Error {
  constructor() {
    super("A backup is already waiting or running. Wait for it to finish.")
  }
}

/** Records a request for the host's cron job to pick up. One open at a time. */
export async function createBackupRequest(userId: string): Promise<void> {
  try {
    const { rowCount } = await query(
      `insert into backup_requests (requested_by)
       select $1
        where not exists (select 1 from backup_requests where status in ('pending', 'running'))`,
      [userId],
    )
    if (rowCount === 0) throw new BackupAlreadyRequestedError()
  } catch (error) {
    // Two clicks at once: the partial unique index refuses the second.
    if ((error as { code?: string })?.code === "23505") throw new BackupAlreadyRequestedError()
    throw error
  }
}
