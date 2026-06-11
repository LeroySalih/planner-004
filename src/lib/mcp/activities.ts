import { query, withDbClient } from '@/lib/db'
import { SCORABLE_ACTIVITY_TYPES, NON_SCORABLE_ACTIVITY_TYPES } from '@/dino.config'
import { assertLessonUnitIsInactive } from '@/lib/mcp/guards'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

export const ACTIVITY_TYPES = [...SCORABLE_ACTIVITY_TYPES, ...NON_SCORABLE_ACTIVITY_TYPES] as const
export type ActivityType = typeof ACTIVITY_TYPES[number]

export type ActivitySummary = {
  activity_id: string
  lesson_id: string
  title: string | null
  type: string
  order_index: number | null
  is_summative: boolean
  active: boolean
}

const TEXT_BODY_DATA_FORMAT = '{ "text": "<markdown content>", "displayType"?: "default" | "exam-tip" }'

export function validateBodyDataForType(type: string, bodyData: unknown): void {
  if (bodyData == null) return

  if (type === 'text') {
    if (typeof bodyData !== 'object' || Array.isArray(bodyData)) {
      throw new Error(`Invalid body_data for type "text". Expected format: ${TEXT_BODY_DATA_FORMAT}`)
    }
    const record = bodyData as Record<string, unknown>
    if (typeof record.text !== 'string' || !record.text.trim()) {
      throw new Error(`Invalid body_data for type "text": "text" is required and must be a non-empty string. Expected format: ${TEXT_BODY_DATA_FORMAT}`)
    }
    if (record.displayType !== undefined && record.displayType !== 'default' && record.displayType !== 'exam-tip') {
      throw new Error(`Invalid body_data for type "text": "displayType" must be "default" or "exam-tip". Expected format: ${TEXT_BODY_DATA_FORMAT}`)
    }
    const allowedKeys = new Set(['text', 'displayType'])
    const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key))
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid body_data for type "text": unexpected field(s) ${unknownKeys.join(', ')}. Expected format: ${TEXT_BODY_DATA_FORMAT}`)
    }
  }
}

export async function listActivitiesForLesson(lessonId: string): Promise<ActivitySummary[]> {
  const { rows } = await query<{
    activity_id: string
    lesson_id: string
    title: string | null
    type: string
    order_by: number | null
    is_summative: boolean
    active: boolean
  }>(
    `select activity_id, lesson_id, title, type, order_by, is_summative, active
     from activities
     where lesson_id = $1 and active = true
     order by order_by asc nulls last, title asc`,
    [lessonId],
  )

  return (rows ?? []).map((row) => ({
    activity_id: row.activity_id,
    lesson_id: row.lesson_id,
    title: row.title,
    type: row.type,
    order_index: row.order_by,
    is_summative: row.is_summative ?? false,
    active: row.active ?? true,
  }))
}

export async function createActivity(
  lessonId: string,
  type: ActivityType,
  title?: string | null,
  bodyData?: unknown,
  isSummative?: boolean,
): Promise<ActivitySummary> {
  const isScorableType = (SCORABLE_ACTIVITY_TYPES as readonly string[]).includes(type)

  if (isSummative && !isScorableType) {
    throw new Error('Only scorable activity types can be marked as summative')
  }

  const effectiveIsSummative = isScorableType ? (isSummative ?? false) : false

  validateBodyDataForType(type, bodyData)

  let result: ActivitySummary | null = null

  await withDbClient(async (client) => {
    await assertLessonUnitIsInactive(client, lessonId)

    const { rows: maxRows } = await client.query<{ order_by: number }>(
      'select order_by from activities where lesson_id = $1 order by order_by desc nulls last limit 1',
      [lessonId],
    )
    const nextOrder = (maxRows[0]?.order_by ?? -1) + 1

    const { rows } = await client.query<{
      activity_id: string
      lesson_id: string
      title: string | null
      type: string
      order_by: number | null
      is_summative: boolean
      active: boolean
    }>(
      `insert into activities (lesson_id, title, type, body_data, is_summative, order_by, active)
       values ($1, $2, $3, $4, $5, $6, true)
       returning activity_id, lesson_id, title, type, order_by, is_summative, active`,
      [
        lessonId,
        title?.trim() ?? null,
        type,
        bodyData != null ? JSON.stringify(bodyData) : null,
        effectiveIsSummative,
        nextOrder,
      ],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create activity')
    result = {
      activity_id: row.activity_id,
      lesson_id: row.lesson_id,
      title: row.title,
      type: row.type,
      order_index: row.order_by,
      is_summative: row.is_summative ?? false,
      active: row.active ?? true,
    }
  })

  if (!result) throw new Error('Failed to create activity')
  return result
}

export type UploadedFileResult = {
  activity_id: string
  lesson_id: string
  file_name: string
  size_bytes: number
  url: string
}

export async function uploadActivityFile(
  lessonId: string,
  activityId: string,
  fileName: string,
  base64Content: string,
  contentType?: string | null,
): Promise<UploadedFileResult> {
  // Validate and decode before touching the DB
  let buffer: Buffer
  try {
    buffer = Buffer.from(base64Content, 'base64')
  } catch {
    throw new Error('Invalid base64 content')
  }
  if (buffer.byteLength === 0) throw new Error('File content is empty')

  // Validate activity exists, belongs to lesson, and is a file-download type
  const { rows } = await query<{ activity_id: string; type: string; lesson_id: string }>(
    `select activity_id, type, lesson_id
     from activities
     where activity_id = $1 and lesson_id = $2
     limit 1`,
    [activityId, lessonId],
  )
  const activity = rows[0]
  if (!activity) throw new Error(`Activity ${activityId} not found in lesson ${lessonId}`)
  if (activity.type !== 'file-download' && activity.type !== 'display-image') {
    throw new Error(`Activity ${activityId} is type "${activity.type}" — only file-download and display-image activities accept file uploads`)
  }

  // Safety guard — unit must be inactive
  await withDbClient(async (client) => {
    await assertLessonUnitIsInactive(client, lessonId)
  })

  // Upload using the same path convention as the app
  const fullPath = `lessons/${lessonId}/activities/${activityId}/${fileName}`
  const storage = createLocalStorageClient('lessons')
  const { error } = await storage.upload(fullPath, buffer, {
    contentType: contentType ?? undefined,
    uploadedBy: 'mcp',
    originalPath: fileName,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const urlParts = ['lessons', lessonId, 'activities', activityId, fileName]
    .map(encodeURIComponent)
    .join('/')
  const url = `/api/files/${urlParts}`

  if (activity.type === 'display-image') {
    await query(
      'update activities set body_data = $1::jsonb where activity_id = $2',
      [JSON.stringify({ imageFile: fileName, fileUrl: fileName }), activityId],
    )
  }

  return {
    activity_id: activityId,
    lesson_id: lessonId,
    file_name: fileName,
    size_bytes: buffer.byteLength,
    url,
  }
}

export async function updateActivity(
  activityId: string,
  fields: {
    title?: string | null
    bodyData?: unknown
    isSummative?: boolean
  },
): Promise<ActivitySummary> {
  let result: ActivitySummary | null = null

  await withDbClient(async (client) => {
    const { rows: existing } = await client.query<{ activity_id: string; lesson_id: string; type: string }>(
      'select activity_id, lesson_id, type from activities where activity_id = $1 limit 1',
      [activityId],
    )
    if (!existing[0]) throw new Error(`Activity ${activityId} not found`)

    if ('bodyData' in fields) {
      validateBodyDataForType(existing[0].type, fields.bodyData)
    }

    await assertLessonUnitIsInactive(client, existing[0].lesson_id)

    // Guard: can't mark a non-scorable type as summative
    if (fields.isSummative === true) {
      const isScorableType = SCORABLE_ACTIVITY_TYPES.includes(existing[0].type as typeof SCORABLE_ACTIVITY_TYPES[number])
      if (!isScorableType) {
        throw new Error(`Only scorable activity types can be marked as summative. "${existing[0].type}" is non-scorable.`)
      }
    }

    // Build SET clause dynamically from provided fields
    const setClauses: string[] = []
    const values: unknown[] = []

    if ('title' in fields) {
      values.push(fields.title?.trim() ?? null)
      setClauses.push(`title = $${values.length}`)
    }
    if ('bodyData' in fields) {
      values.push(fields.bodyData !== undefined ? JSON.stringify(fields.bodyData) : null)
      setClauses.push(`body_data = $${values.length}`)
    }
    if ('isSummative' in fields && fields.isSummative !== undefined) {
      values.push(fields.isSummative)
      setClauses.push(`is_summative = $${values.length}`)
    }

    if (setClauses.length === 0) throw new Error('No fields provided to update')

    values.push(activityId)
    const { rows } = await client.query<{
      activity_id: string; lesson_id: string; title: string | null
      type: string; order_by: number; is_summative: boolean; active: boolean
    }>(
      `update activities set ${setClauses.join(', ')}
       where activity_id = $${values.length}
       returning activity_id, lesson_id, title, type, order_by, is_summative, active`,
      values,
    )
    const row = rows[0]
    if (!row) throw new Error('Update failed')
    result = {
      activity_id: row.activity_id,
      lesson_id: row.lesson_id,
      title: row.title,
      type: row.type,
      order_index: row.order_by,
      is_summative: row.is_summative ?? false,
      active: row.active ?? true,
    }
  })

  if (!result) throw new Error('Failed to update activity')
  return result
}

export type ActivityScLinkResult = {
  activity_id: string
  success_criteria_id: string
  already_linked: boolean
}

export async function addSuccessCriterionToActivity(
  activityId: string,
  successCriteriaId: string,
): Promise<ActivityScLinkResult> {
  let result: ActivityScLinkResult | null = null

  await withDbClient(async (client) => {
    // Validate activity exists and get its lesson_id for the guard
    const { rows: actRows } = await client.query<{ activity_id: string; lesson_id: string }>(
      'select activity_id, lesson_id from activities where activity_id = $1 limit 1',
      [activityId],
    )
    if (!actRows[0]) throw new Error(`Activity ${activityId} not found`)
    await assertLessonUnitIsInactive(client, actRows[0].lesson_id)

    // Validate SC exists
    const { rows: scRows } = await client.query<{ success_criteria_id: string }>(
      'select success_criteria_id from success_criteria where success_criteria_id = $1 limit 1',
      [successCriteriaId],
    )
    if (!scRows[0]) throw new Error(`Success criterion ${successCriteriaId} not found`)

    const { rowCount } = await client.query(
      `insert into activity_success_criteria (activity_id, success_criteria_id)
       values ($1, $2)
       on conflict do nothing`,
      [activityId, successCriteriaId],
    )

    result = {
      activity_id: activityId,
      success_criteria_id: successCriteriaId,
      already_linked: (rowCount ?? 0) === 0,
    }
  })

  if (!result) throw new Error('Failed to link success criterion to activity')
  return result
}

export async function removeActivity(
  activityId: string,
  lessonId: string,
): Promise<{ activity_id: string; lesson_id: string }> {
  await withDbClient(async (client) => {
    await assertLessonUnitIsInactive(client, lessonId)

    const { rows } = await client.query<{ activity_id: string }>(
      'select activity_id from activities where activity_id = $1 and lesson_id = $2 limit 1',
      [activityId, lessonId],
    )
    if (!rows[0]) throw new Error(`Activity ${activityId} not found in lesson ${lessonId}`)

    await client.query(
      'delete from activity_success_criteria where activity_id = $1',
      [activityId],
    )
    await client.query(
      'delete from activities where activity_id = $1 and lesson_id = $2',
      [activityId, lessonId],
    )
  })

  return { activity_id: activityId, lesson_id: lessonId }
}
