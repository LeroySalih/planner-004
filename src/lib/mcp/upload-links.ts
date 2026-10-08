import { createHash, randomBytes } from 'node:crypto'

import { query } from '@/lib/db'
import type { McpCaller } from '@/lib/mcp/auth'

const LINK_LIFETIME_MINUTES = 15

export type UploadLink = {
  link_id: string
  target: 'activity' | 'lesson'
  lesson_id: string
  activity_id: string | null
  file_name: string | null
  caller: McpCaller
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url')

export async function createUploadLink(
  caller: McpCaller,
  target: { lessonId: string; activityId: string | null; fileName: string | null },
): Promise<{ token: string; expiresAt: string }> {
  if (target.activityId) {
    const { rows } = await query<{ type: string }>(
      'select type from activities where activity_id = $1 and lesson_id = $2 limit 1',
      [target.activityId, target.lessonId],
    )
    if (!rows[0]) throw new Error(`Activity ${target.activityId} not found in lesson ${target.lessonId}`)
    if (rows[0].type !== 'file-download' && rows[0].type !== 'display-image') {
      throw new Error(`Activity ${target.activityId} is type "${rows[0].type}" — only file-download and display-image activities accept file uploads`)
    }
  } else {
    const { rows } = await query('select 1 from lessons where lesson_id = $1 limit 1', [target.lessonId])
    if (!rows[0]) throw new Error(`Lesson ${target.lessonId} not found`)
  }

  // Links are only useful for minutes; anything a day past expiry is litter.
  await query("delete from mcp_upload_links where expires_at < now() - interval '1 day'")

  const token = randomBytes(32).toString('base64url')
  const { rows } = await query<{ expires_at: Date }>(
    `insert into mcp_upload_links
       (token_hash, target, lesson_id, activity_id, file_name, auth_method, user_id, oauth_client_id, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9))
     returning expires_at`,
    [
      hashToken(token),
      target.activityId ? 'activity' : 'lesson',
      target.lessonId,
      target.activityId,
      target.fileName,
      caller.method,
      caller.userId,
      caller.clientId,
      LINK_LIFETIME_MINUTES,
    ],
  )
  return { token, expiresAt: rows[0].expires_at.toISOString() }
}

/**
 * Marks the link used and returns it, or null if it is unknown, expired or
 * already used. Claiming in one update means two concurrent uploads cannot
 * both get through.
 */
export async function claimUploadLink(token: string): Promise<UploadLink | null> {
  const { rows } = await query<{
    link_id: string
    target: 'activity' | 'lesson'
    lesson_id: string
    activity_id: string | null
    file_name: string | null
    auth_method: 'oauth' | 'service_key'
    user_id: string | null
    oauth_client_id: string | null
  }>(
    `update mcp_upload_links set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning link_id, target, lesson_id, activity_id, file_name, auth_method, user_id, oauth_client_id`,
    [hashToken(token)],
  )
  const row = rows[0]
  if (!row) return null
  const caller: McpCaller = row.auth_method === 'oauth' && row.user_id && row.oauth_client_id
    ? { method: 'oauth', userId: row.user_id, clientId: row.oauth_client_id }
    : { method: 'service_key', userId: null, clientId: null }
  return {
    link_id: row.link_id,
    target: row.target,
    lesson_id: row.lesson_id,
    activity_id: row.activity_id,
    file_name: row.file_name,
    caller,
  }
}

/** A failed upload gives the link back, so the caller can retry before it expires. */
export async function releaseUploadLink(linkId: string): Promise<void> {
  await query('update mcp_upload_links set used_at = null where link_id = $1', [linkId])
}
