import { createHash, randomBytes } from 'node:crypto'

import { query } from '@/lib/db'
import { ASSESSMENT_UPLOAD_MAX_BYTES, listAssessmentPupils } from '@/lib/assessments/store'
import { assertActivityAcceptsFile } from '@/lib/mcp/activities'
import type { McpCaller } from '@/lib/mcp/auth'
import { MCP_UPLOAD_MAX_BYTES } from '@/lib/mcp/file-input'
import { ASSESSMENT_PAPER_UPLOAD_MAX_BYTES, assertPupilSitsAssessment } from '@/lib/assessment-paper/files'
import { isAssessmentPaperType, isPowerPointAssessmentType, isQuestionMarkedActivityType } from '@/dino.config'
import { AssessmentPaperActivityBodySchema, PowerPointAssessmentActivityBodySchema } from '@/types'
import { PRACTICAL_UPLOAD_MAX_BYTES, SUPPLIED_IMAGE_MAX_BYTES } from '@/lib/powerpoint-assessment/files'

const LINK_LIFETIME_MINUTES = 15

export type AssessmentActivityUploadKind = 'question_paper' | 'mark_scheme' | 'script' | 'supplied_image' | 'practical_file'

/** The kinds that name a pupil (mcp_upload_links_target_shape, migration 143). */
const PUPIL_UPLOAD_KINDS: readonly AssessmentActivityUploadKind[] = ['script', 'practical_file']

/** A supplied image's name, as storeSuppliedImage takes it. */
function checkImageName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('image_name must not be empty')
  if (trimmed.length > 200) throw new Error('image_name must be at most 200 characters')
  if (/[\u0000-\u001f\u007f\\/]/.test(trimmed)) throw new Error('image_name may not contain control characters, / or \\')
  return trimmed
}

type UploadTarget = 'activity' | 'lesson' | 'assessment' | 'assessment-activity'

export type UploadLink = {
  link_id: string
  target: UploadTarget
  lesson_id: string | null
  activity_id: string | null
  assessment_id: string | null
  pupil_id: string | null
  upload_kind: AssessmentActivityUploadKind | null
  /** practical_file: the upload slot the file goes in. */
  slot_key: string | null
  /** supplied_image: the image's name; otherwise the name to store the file under. */
  file_name: string | null
  caller: McpCaller
}

/** The most an upload link takes: a supplied image is smaller than the rest. */
export function uploadLinkMaxBytes(link: { target: UploadTarget; assessment_id: string | null; upload_kind: AssessmentActivityUploadKind | null }): number {
  if (link.assessment_id) return ASSESSMENT_UPLOAD_MAX_BYTES
  if (link.target !== 'assessment-activity') return MCP_UPLOAD_MAX_BYTES
  if (link.upload_kind === 'supplied_image') return SUPPLIED_IMAGE_MAX_BYTES
  if (link.upload_kind === 'practical_file') return PRACTICAL_UPLOAD_MAX_BYTES
  return ASSESSMENT_PAPER_UPLOAD_MAX_BYTES
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url')

export async function createUploadLink(
  caller: McpCaller,
  target:
    | { lessonId: string; activityId: string | null; assessmentId?: undefined; uploadKind?: undefined; fileName: string | null }
    | { assessmentId: string; pupilId?: string | null; lessonId?: undefined; activityId?: undefined; uploadKind?: undefined; fileName: string | null }
    | { assessmentActivityId: string; uploadKind: AssessmentActivityUploadKind; pupilId?: string | null; slotKey?: string | null; assessmentId?: undefined; lessonId?: undefined; activityId?: undefined; fileName: string | null },
): Promise<{ token: string; expiresAt: string }> {
  let lessonId = target.lessonId ?? null
  let activityId = target.activityId ?? null
  let fileName = target.fileName
  let slotKey: string | null = null
  if ('assessmentActivityId' in target) {
    // Checked now as well as on upload, so a link that can only fail is never
    // handed out.
    const { rows } = await query<{ lesson_id: string; type: string | null; body_data: unknown }>(
      'select lesson_id, type, body_data from activities where activity_id = $1 limit 1',
      [target.assessmentActivityId],
    )
    if (!rows[0]) throw new Error(`Activity ${target.assessmentActivityId} not found`)
    if (!isQuestionMarkedActivityType(rows[0].type)) {
      throw new Error(`Activity ${target.assessmentActivityId} is not an assessment paper or PowerPoint assessment`)
    }
    const uploadKind = target.uploadKind
    if (fileName !== null && uploadKind !== 'supplied_image') {
      throw new Error('image_name is only for kind "supplied_image"')
    }
    if (uploadKind === 'script') {
      if (!isAssessmentPaperType(rows[0].type)) {
        throw new Error(
          isPowerPointAssessmentType(rows[0].type)
            ? `Activity ${target.assessmentActivityId} is a PowerPoint assessment, which has no scripts: upload a pupil's files with kind "practical_file"`
            : `Activity ${target.assessmentActivityId} is not an assessment paper; scripts are for assessment papers`,
        )
      }
      if (!target.pupilId) throw new Error('pupil_id is required for a script')
      const body = AssessmentPaperActivityBodySchema.safeParse(rows[0].body_data ?? {})
      if (!body.success || !body.data.questionPaperPath) {
        throw new Error('Upload the question paper with its front sheet first: each script\'s page 1 is checked against it')
      }
      await assertPupilSitsAssessment(target.assessmentActivityId, target.pupilId)
    } else if (uploadKind === 'supplied_image' || uploadKind === 'practical_file') {
      if (!isPowerPointAssessmentType(rows[0].type)) {
        throw new Error(`Activity ${target.assessmentActivityId} is not a PowerPoint assessment; kind "${uploadKind}" is for PowerPoint assessments`)
      }
      if (uploadKind === 'supplied_image') {
        if (target.pupilId || target.slotKey) throw new Error('pupil_id and slot are only for kind "practical_file"; a supplied image belongs to the whole activity')
        fileName = fileName === null ? null : checkImageName(fileName)
      } else {
        if (!target.pupilId) throw new Error('pupil_id is required for kind "practical_file"')
        if (!target.slotKey) throw new Error('slot is required for kind "practical_file"')
        const body = PowerPointAssessmentActivityBodySchema.safeParse(rows[0].body_data ?? {})
        const slots = body.success ? body.data.uploadSlots : []
        if (!slots.some((slot) => slot.key === target.slotKey)) {
          throw new Error(`No upload slot "${target.slotKey}" on this activity. Its slots are: ${slots.map((slot) => `${slot.key} (${slot.kind})`).join(', ') || 'none'}`)
        }
        await assertPupilSitsAssessment(target.assessmentActivityId, target.pupilId)
        slotKey = target.slotKey
        // The file keeps the name it is uploaded with.
        fileName = null
      }
    } else if (target.pupilId || target.slotKey) {
      throw new Error(
        isPowerPointAssessmentType(rows[0].type)
          ? 'pupil_id and slot are only for kind "practical_file"; the question paper and mark scheme belong to the whole activity'
          : 'pupil_id is only for a script; the question paper and mark scheme belong to the whole activity',
      )
    }
    lessonId = rows[0].lesson_id
    activityId = target.assessmentActivityId
  } else if (target.assessmentId) {
    const { rows } = await query(
      "select 1 from assessments where assessment_id::text = $1 and active limit 1",
      [target.assessmentId],
    )
    if (!rows[0]) throw new Error(`Assessment paper ${target.assessmentId} not found`)
    if (target.pupilId && !(await listAssessmentPupils(target.assessmentId)).some((p) => p.pupil_id === target.pupilId)) {
      throw new Error(`Pupil ${target.pupilId} did not sit this paper`)
    }
  } else if (target.activityId) {
    const { rows } = await query<{ type: string }>(
      'select type from activities where activity_id = $1 and lesson_id = $2 limit 1',
      [target.activityId, target.lessonId],
    )
    if (!rows[0]) throw new Error(`Activity ${target.activityId} not found in lesson ${target.lessonId}`)
    assertActivityAcceptsFile(target.activityId, rows[0].type, target.fileName)
  } else {
    const { rows } = await query('select 1 from lessons where lesson_id = $1 limit 1', [target.lessonId])
    if (!rows[0]) throw new Error(`Lesson ${target.lessonId} not found`)
  }

  // Links are only useful for minutes; anything a day past expiry is litter.
  await query("delete from mcp_upload_links where expires_at < now() - interval '1 day'")

  const token = randomBytes(32).toString('base64url')
  const kind: UploadTarget = 'assessmentActivityId' in target
    ? 'assessment-activity'
    : target.assessmentId ? 'assessment' : target.activityId ? 'activity' : 'lesson'
  const { rows } = await query<{ expires_at: Date }>(
    `insert into mcp_upload_links
       (token_hash, target, lesson_id, activity_id, assessment_id, pupil_id, upload_kind, slot_key, file_name, auth_method, user_id, oauth_client_id, expires_at)
     values ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12, now() + make_interval(mins => $13))
     returning expires_at`,
    [
      hashToken(token),
      kind,
      lessonId,
      activityId,
      target.assessmentId ?? null,
      'pupilId' in target && (kind === 'assessment' || (target.uploadKind !== undefined && PUPIL_UPLOAD_KINDS.includes(target.uploadKind)))
        ? target.pupilId ?? null
        : null,
      target.uploadKind ?? null,
      slotKey,
      fileName,
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
    target: UploadTarget
    lesson_id: string | null
    activity_id: string | null
    assessment_id: string | null
    pupil_id: string | null
    upload_kind: AssessmentActivityUploadKind | null
    slot_key: string | null
    file_name: string | null
    auth_method: 'oauth' | 'service_key'
    user_id: string | null
    oauth_client_id: string | null
  }>(
    `update mcp_upload_links set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning link_id, target, lesson_id, activity_id, assessment_id::text, pupil_id, upload_kind, slot_key, file_name, auth_method, user_id, oauth_client_id`,
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
    assessment_id: row.assessment_id,
    pupil_id: row.pupil_id,
    upload_kind: row.upload_kind,
    slot_key: row.slot_key,
    file_name: row.file_name,
    caller,
  }
}

/** A failed upload gives the link back, so the caller can retry before it expires. */
export async function releaseUploadLink(linkId: string): Promise<void> {
  await query('update mcp_upload_links set used_at = null where link_id = $1', [linkId])
}
