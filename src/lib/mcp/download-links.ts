import { createHash, randomBytes } from 'node:crypto'

import { query } from '@/lib/db'
import type { McpCaller } from '@/lib/mcp/auth'

const LINK_LIFETIME_MINUTES = 15

export type LessonFile = {
  lesson_id: string
  activity_id: string | null
  activity_title: string | null
  activity_type: string | null
  file_name: string
  size_bytes: number | null
  content_type: string | null
  updated_at: string | null
}

export type DownloadLink = {
  link_id: string
  lesson_id: string
  activity_id: string | null
  file_name: string
  caller: McpCaller
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url')

// Teacher files only. Pupil uploads sit one folder deeper, under
// <lesson>/activities/<activity>/<pupil>, so matching the scope exactly keeps
// them out.
export async function listLessonFiles(lessonId: string): Promise<LessonFile[]> {
  const { rows: lessonRows } = await query('select 1 from lessons where lesson_id = $1 limit 1', [lessonId])
  if (!lessonRows[0]) throw new Error(`Lesson ${lessonId} not found`)

  const { rows } = await query<{
    activity_id: string | null
    activity_title: string | null
    activity_type: string | null
    file_name: string
    size_bytes: string | number | null
    content_type: string | null
    updated_at: Date | null
  }>(
    `select a.activity_id, a.title as activity_title, a.type as activity_type,
            f.file_name, f.size_bytes, f.content_type, f.updated_at
       from stored_files f
       left join activities a
         on a.lesson_id = $1 and f.scope_path = $1 || '/activities/' || a.activity_id
      where f.bucket = 'lessons'
        and (f.scope_path = $1 or a.activity_id is not null)
      order by a.order_by asc nulls first, f.file_name asc`,
    [lessonId],
  )

  return rows.map((row) => ({
    lesson_id: lessonId,
    activity_id: row.activity_id,
    activity_title: row.activity_title,
    activity_type: row.activity_type,
    file_name: row.file_name,
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    content_type: row.content_type,
    updated_at: row.updated_at ? row.updated_at.toISOString() : null,
  }))
}

export function lessonFileStoragePath(lessonId: string, activityId: string | null, fileName: string): string {
  return activityId ? `${lessonId}/activities/${activityId}/${fileName}` : `${lessonId}/${fileName}`
}

export async function createDownloadLink(
  caller: McpCaller,
  target: { lessonId: string; activityId: string | null; fileName: string },
): Promise<{ token: string; expiresAt: string; file: LessonFile }> {
  const file = (await listLessonFiles(target.lessonId)).find(
    (candidate) => candidate.activity_id === target.activityId && candidate.file_name === target.fileName,
  )
  if (!file) {
    const where = target.activityId ? `activity ${target.activityId}` : `lesson ${target.lessonId}'s teacher files`
    throw new Error(`No file "${target.fileName}" in ${where}. Call list_lesson_files for the exact names.`)
  }

  await query("delete from mcp_download_links where expires_at < now() - interval '1 day'")

  const token = randomBytes(32).toString('base64url')
  const { rows } = await query<{ expires_at: Date }>(
    `insert into mcp_download_links
       (token_hash, lesson_id, activity_id, file_name, auth_method, user_id, oauth_client_id, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8))
     returning expires_at`,
    [
      hashToken(token),
      target.lessonId,
      target.activityId,
      target.fileName,
      caller.method,
      caller.userId,
      caller.clientId,
      LINK_LIFETIME_MINUTES,
    ],
  )
  return { token, expiresAt: rows[0].expires_at.toISOString(), file }
}

/**
 * Marks the link used and returns it, or null if it is unknown, expired or
 * already used. Claiming in one update means a link cannot be used twice.
 */
export async function claimDownloadLink(token: string): Promise<DownloadLink | null> {
  const { rows } = await query<{
    link_id: string
    lesson_id: string
    activity_id: string | null
    file_name: string
    auth_method: 'oauth' | 'service_key'
    user_id: string | null
    oauth_client_id: string | null
  }>(
    `update mcp_download_links set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning link_id, lesson_id, activity_id, file_name, auth_method, user_id, oauth_client_id`,
    [hashToken(token)],
  )
  const row = rows[0]
  if (!row) return null
  const caller: McpCaller = row.auth_method === 'oauth' && row.user_id && row.oauth_client_id
    ? { method: 'oauth', userId: row.user_id, clientId: row.oauth_client_id }
    : { method: 'service_key', userId: null, clientId: null }
  return {
    link_id: row.link_id,
    lesson_id: row.lesson_id,
    activity_id: row.activity_id,
    file_name: row.file_name,
    caller,
  }
}

/** A failed download gives the link back, so the caller can retry before it expires. */
export async function releaseDownloadLink(linkId: string): Promise<void> {
  await query('update mcp_download_links set used_at = null where link_id = $1', [linkId])
}
