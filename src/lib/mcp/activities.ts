import { createHash } from 'node:crypto'

import { query, withDbClient } from '@/lib/db'
import { SCORABLE_ACTIVITY_TYPES, NON_SCORABLE_ACTIVITY_TYPES, isLegacyActivityType, isMothballedActivityType, legacyActivityTypeMessage } from '@/dino.config'
import { assertLessonExists } from '@/lib/mcp/guards'
import { MCP_UPLOAD_MAX_BYTES } from '@/lib/mcp/file-input'
import { assertScAllowedForActivity } from '@/lib/curriculum/unit-curriculum-guard'
import { recalculateActivityMaxMarks, recalculateGroupItemsMaxMarks, recalculateMatcherMaxMarks, rescaleStoredMarks } from '@/lib/scoring/derive-max-marks'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { GroupItemsActivityBodySchema, MatcherActivityBodySchema, McqActivityBodySchema, SequenceActivityBodySchema, ShortTextActivityBodySchema, UploadCodeActivityBodySchema, UploadSpreadsheetActivityBodySchema } from '@/types'

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

/**
 * A body_data the app could not render. Without this check MCP stored such a
 * body happily (e.g. a 13-item group-items activity), and the activity then
 * failed silently everywhere the app parses it against its schema.
 *
 * `code` is LIMIT_EXCEEDED when a list or text is longer than the app allows,
 * BELOW_MINIMUM when it is shorter, and INVALID_BODY_DATA otherwise.
 */
export class ActivityBodyDataError extends Error {
  constructor(
    readonly code: 'LIMIT_EXCEEDED' | 'BELOW_MINIMUM' | 'INVALID_BODY_DATA',
    readonly field: string,
    message: string,
    readonly limit: number | null = null,
    readonly received: number | null = null,
  ) {
    super(`[${code}] ${message}`)
    this.name = 'ActivityBodyDataError'
  }
}

// The same schemas the app renders and marks with, so MCP cannot store a body
// the app will refuse. Limits come from the schemas rather than being copied.
const BODY_SCHEMAS = {
  'group-items': GroupItemsActivityBodySchema,
  matcher: MatcherActivityBodySchema,
  sequence: SequenceActivityBodySchema,
} as const

const UNIT_NAMES: Record<string, [string, string]> = {
  items: ['item', 'items'],
  groups: ['group', 'groups'],
  pairs: ['pair', 'pairs'],
  terms: ['term', 'terms'],
}

function fieldName(path: PropertyKey[]): string {
  return ['body_data', ...path].reduce<string>(
    (name, key) => (typeof key === 'number' ? `${name}[${key}]` : `${name}.${String(key)}`),
    '',
  ).replace(/^\./, '')
}

function valueAt(data: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((value, key) => (value as Record<PropertyKey, unknown> | null)?.[key], data)
}

function validateAgainstSchema(type: keyof typeof BODY_SCHEMAS, bodyData: unknown): void {
  const parsed = BODY_SCHEMAS[type].safeParse(bodyData)
  if (parsed.success) {
    if (type === 'group-items') {
      const body = parsed.data as { groups: Array<{ id: string }>; items: Array<{ id: string; groupId: string }> }
      const groupIds = new Set(body.groups.map((g) => g.id))
      const index = body.items.findIndex((item) => !groupIds.has(item.groupId))
      if (index >= 0) {
        throw new ActivityBodyDataError(
          'INVALID_BODY_DATA',
          `body_data.items[${index}].groupId`,
          `body_data.items[${index}].groupId "${body.items[index].groupId}" does not match any group id (${[...groupIds].join(', ')}).`,
        )
      }
    }
    return
  }

  const issue = parsed.error.issues[0]
  const field = fieldName(issue.path)
  const value = valueAt(bodyData, issue.path)
  if ((issue.code === 'too_big' || issue.code === 'too_small') && (issue.origin === 'array' || issue.origin === 'string')) {
    const limit = Number(issue.code === 'too_big' ? issue.maximum : issue.minimum)
    const received = Array.isArray(value) || typeof value === 'string' ? value.length : null
    const last = issue.path[issue.path.length - 1]
    const [one, many] = issue.origin === 'array'
      ? UNIT_NAMES[String(last)] ?? ['entry', 'entries']
      : ['character', 'characters']
    const count = (n: number) => `${n} ${n === 1 ? one : many}`
    if (issue.code === 'too_big') {
      throw new ActivityBodyDataError(
        'LIMIT_EXCEEDED',
        field,
        `${field} has ${received === null ? 'too many' : count(received)}, but a ${type} activity allows at most ${count(limit)}.`
          + (issue.origin === 'array' ? ' Split the content across more than one activity.' : ''),
        limit,
        received,
      )
    }
    throw new ActivityBodyDataError(
      'BELOW_MINIMUM',
      field,
      `${field} has ${received === null ? 'too few' : count(received)}, but a ${type} activity needs at least ${count(limit)}.`,
      limit,
      received,
    )
  }
  throw new ActivityBodyDataError('INVALID_BODY_DATA', field, `${field}: ${issue.message}`)
}

// AI-marked tasks the marker cannot mark without a task and guidance, so they
// are required even when no body_data is passed. Without this an empty
// upload-code activity was stored, and every pupil submission to it failed.
const MARKED_TASK_BODY_SCHEMAS = {
  'upload-code': UploadCodeActivityBodySchema,
  'upload-spreadsheet': UploadSpreadsheetActivityBodySchema,
} as const

export function validateBodyDataForType(type: string, bodyData: unknown): void {
  if (type in MARKED_TASK_BODY_SCHEMAS) {
    const parsed = MARKED_TASK_BODY_SCHEMAS[type as keyof typeof MARKED_TASK_BODY_SCHEMAS].safeParse(bodyData ?? {})
    if (!parsed.success) {
      const field = fieldName(parsed.error.issues[0].path)
      throw new ActivityBodyDataError(
        'INVALID_BODY_DATA',
        field,
        `${field}: an ${type} activity needs body_data { "task": "…", "markingGuidance": "…"${type === 'upload-code' ? ', "language"?: "python", "starterCode"?: "…"' : ''} }, or the AI marker cannot mark pupils' work`,
      )
    }
    return
  }
  if (bodyData == null) return

  if (type in BODY_SCHEMAS) {
    validateAgainstSchema(type as keyof typeof BODY_SCHEMAS, bodyData)
    return
  }

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

export type ActivityDetail = ActivitySummary & {
  body_data: unknown
  notes: string | null
  max_marks: number | null
  success_criteria: Array<{ success_criteria_id: string; description: string | null; sc_type: string | null }>
}

export async function getActivity(activityId: string): Promise<ActivityDetail> {
  const { rows } = await query<{
    activity_id: string
    lesson_id: string
    title: string | null
    type: string
    order_by: number | null
    is_summative: boolean | null
    active: boolean | null
    body_data: unknown
    notes: string | null
    max_marks: number | null
  }>(
    `select activity_id, lesson_id, title, type, order_by, is_summative, active, body_data, notes, max_marks
       from activities where activity_id = $1 limit 1`,
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Activity ${activityId} not found`)

  const { rows: criteria } = await query<{ success_criteria_id: string; description: string | null; sc_type: string | null }>(
    `select sc.success_criteria_id, sc.description, sc.sc_type
       from activity_success_criteria asc_link
       join success_criteria sc on sc.success_criteria_id = asc_link.success_criteria_id
      where asc_link.activity_id = $1
      order by sc.description asc`,
    [activityId],
  )

  return {
    activity_id: row.activity_id,
    lesson_id: row.lesson_id,
    title: row.title,
    type: row.type,
    order_index: row.order_by,
    is_summative: row.is_summative ?? false,
    active: row.active !== false,
    body_data: row.body_data ?? null,
    notes: row.notes,
    max_marks: row.max_marks,
    success_criteria: criteria,
  }
}

export async function createActivity(
  lessonId: string,
  type: ActivityType,
  title?: string | null,
  bodyData?: unknown,
  isSummative?: boolean,
  maxMarks?: number,
): Promise<ActivitySummary> {
  if (isLegacyActivityType(type)) {
    throw new Error(legacyActivityTypeMessage(type))
  }

  const isScorableType = (SCORABLE_ACTIVITY_TYPES as readonly string[]).includes(type)

  if (isSummative && !isScorableType) {
    throw new Error('Only scorable activity types can be marked as summative')
  }
  if (maxMarks !== undefined) assertMaxMarksSettable(type, maxMarks)
  // Same default as the app's activity form.
  const effectiveMaxMarks = maxMarks ?? (type === 'short-text-question' ? 3 : 1)

  const effectiveIsSummative = isScorableType ? (isSummative ?? false) : false

  validateBodyDataForType(type, bodyData)

  let result: ActivitySummary | null = null

  await withDbClient(async (client) => {
    await assertLessonExists(client, lessonId)

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
      `insert into activities (lesson_id, title, type, body_data, is_summative, order_by, max_marks, active)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       returning activity_id, lesson_id, title, type, order_by, is_summative, active`,
      [
        lessonId,
        title?.trim() ?? null,
        type,
        bodyData != null ? JSON.stringify(bodyData) : null,
        effectiveIsSummative,
        nextOrder,
        effectiveMaxMarks,
      ],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create activity')
    // A matcher is out of its pair count and a group-items out of its item
    // count, as when the app creates them.
    await recalculateMatcherMaxMarks(client, row.activity_id)
    await recalculateGroupItemsMaxMarks(client, row.activity_id)
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

const FILE_ACTIVITY_TYPES = ['file-download', 'display-image', 'display-webpage']

/** Which activities take a file, and for a web page, that the file is HTML. */
export function assertActivityAcceptsFile(activityId: string, type: string, fileName?: string | null) {
  if (!FILE_ACTIVITY_TYPES.includes(type)) {
    throw new Error(`Activity ${activityId} is type "${type}" — only file-download, display-image and display-webpage activities accept file uploads`)
  }
  if (type === 'display-webpage' && fileName != null && !/\.html?$/i.test(fileName)) {
    throw new Error(`A display-webpage activity takes one .html file; "${fileName}" is not one`)
  }
}

/** Sets body_data.htmlFile, keeping `url`. Returns the file it replaced. */
async function setWebpageFile(activityId: string, fileName: string): Promise<string | null> {
  const { rows } = await query<{ previous: string | null }>(
    `with old as (select body_data::jsonb ->> 'htmlFile' as previous from activities where activity_id = $1 for update)
     update activities a
        set body_data = (coalesce(a.body_data::jsonb, '{}'::jsonb) - 'htmlFile' || jsonb_build_object('htmlFile', $2::text))
       from old
      where a.activity_id = $1
     returning old.previous`,
    [activityId, fileName],
  )
  return rows[0]?.previous ?? null
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
  buffer: Buffer,
  contentType?: string | null,
): Promise<UploadedFileResult> {
  if (buffer.byteLength > MCP_UPLOAD_MAX_BYTES) {
    throw new Error(`File exceeds the 5 MB limit (${buffer.byteLength} bytes)`)
  }

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
  assertActivityAcceptsFile(activityId, activity.type, fileName)
  const isWebpage = activity.type === 'display-webpage'

  // Upload using the same path convention as the app
  const activityDir = `lessons/${lessonId}/activities/${activityId}`
  const storage = createLocalStorageClient('lessons')
  const { error } = await storage.upload(`${activityDir}/${fileName}`, buffer, {
    contentType: isWebpage ? 'text/html' : contentType ?? undefined,
    uploadedBy: 'mcp',
    originalPath: fileName,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const urlParts = ['lessons', lessonId, 'activities', activityId, fileName]
    .map(encodeURIComponent)
    .join('/')
  // /api/files sends HTML as a download; the page itself opens through the
  // sandboxed webpage route.
  const url = isWebpage
    ? `/api/activity-webpage/${encodeURIComponent(activityId)}`
    : `/api/files/${urlParts}`

  if (activity.type === 'display-image') {
    await query(
      'update activities set body_data = $1::jsonb where activity_id = $2',
      [JSON.stringify({ imageFile: fileName, fileUrl: fileName }), activityId],
    )
  } else if (isWebpage) {
    // A web page holds one file: point the activity at the new one, keep any
    // link it also carries, and delete the file it replaces.
    const previous = await setWebpageFile(activityId, fileName)
    if (previous && previous !== fileName) {
      await storage.remove([`${activityDir}/${previous}`])
    }
  }

  return {
    activity_id: activityId,
    lesson_id: lessonId,
    file_name: fileName,
    size_bytes: buffer.byteLength,
    url,
  }
}

const activityFileUrl = (lessonId: string, activityId: string, fileName: string) =>
  `/api/files/${['lessons', lessonId, 'activities', activityId, fileName].map(encodeURIComponent).join('/')}`

async function readActivityForFiles(activityId: string) {
  const { rows } = await query<{ lesson_id: string; type: string; body_data: unknown }>(
    'select lesson_id, type, body_data from activities where activity_id = $1 limit 1',
    [activityId],
  )
  if (!rows[0]) throw new Error(`Activity ${activityId} not found`)
  return rows[0]
}

export type RemovedActivityFile = {
  activity_id: string
  lesson_id: string
  file_name: string
  /** body_data fields that named the file and were cleared. */
  cleared_fields: string[]
  /** True when body_data text (e.g. an <img> in a question) still links to the file. */
  still_referenced: boolean
}

/**
 * Deletes one teacher file from an activity. A display-image's image, a web
 * page's HTML file and an MCQ's question image are cleared from body_data
 * with it, so the activity does not point at a missing file.
 */
export async function removeActivityFile(activityId: string, fileName: string): Promise<RemovedActivityFile> {
  const activity = await readActivityForFiles(activityId)
  const scope = `${activity.lesson_id}/activities/${activityId}`
  const { rows } = await query('select 1 from stored_files where bucket = $1 and scope_path = $2 and file_name = $3 limit 1', ['lessons', scope, fileName])
  if (!rows[0]) {
    throw new Error(`Activity ${activityId} has no file "${fileName}". Call list_lesson_files for the exact names.`)
  }

  const { error } = await createLocalStorageClient('lessons').remove([`${scope}/${fileName}`])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)

  const body = activity.body_data && typeof activity.body_data === 'object' ? activity.body_data as Record<string, unknown> : {}
  const cleared = ['imageFile', 'fileUrl', 'htmlFile'].filter((key) => body[key] === fileName)
  if (cleared.length > 0) {
    await query(
      'update activities set body_data = body_data::jsonb - $2::text[] where activity_id = $1',
      [activityId, cleared],
    )
  }

  const url = activityFileUrl(activity.lesson_id, activityId, fileName)
  return {
    activity_id: activityId,
    lesson_id: activity.lesson_id,
    file_name: fileName,
    cleared_fields: cleared,
    still_referenced: JSON.stringify(body).includes(url),
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export type ActivityImage = {
  activity_id: string
  lesson_id: string
  file_name: string
  size_bytes: number
  url: string
  img_tag: string
}

/**
 * Stores an image in an activity's folder for its body_data to link to, as
 * <img src="url"> in a question, so the image is not held inline as base64.
 * Not for file-download activities, where every file in the folder is offered
 * to pupils as a download; nor display-image, which upload_activity_file sets.
 */
async function storeActivityImage(
  activity: { lesson_id: string; type: string },
  activityId: string,
  fileName: string,
  buffer: Buffer,
): Promise<ActivityImage> {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const contentType = IMAGE_TYPES[extension]
  if (!contentType) throw new Error(`"${fileName}" is not a png, jpg, gif or webp image`)
  if (FILE_ACTIVITY_TYPES.includes(activity.type)) {
    throw new Error(`Activity ${activityId} is a ${activity.type}; use upload_activity_file for its files`)
  }
  const { error } = await createLocalStorageClient('lessons').upload(
    `lessons/${activity.lesson_id}/activities/${activityId}/${fileName}`,
    buffer,
    { contentType, uploadedBy: 'mcp', originalPath: fileName },
  )
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  const url = activityFileUrl(activity.lesson_id, activityId, fileName)
  return {
    activity_id: activityId,
    lesson_id: activity.lesson_id,
    file_name: fileName,
    size_bytes: buffer.byteLength,
    url,
    img_tag: `<img src="${url}" alt="">`,
  }
}

export async function uploadActivityImage(activityId: string, fileName: string, buffer: Buffer): Promise<ActivityImage> {
  if (buffer.byteLength > MCP_UPLOAD_MAX_BYTES) {
    throw new Error(`File exceeds the 5 MB limit (${buffer.byteLength} bytes)`)
  }
  return storeActivityImage(await readActivityForFiles(activityId), activityId, fileName, buffer)
}

const INLINE_IMAGE = /data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)/g

export type MovedInlineImages = {
  activity_id: string
  images_moved: number
  body_bytes_before: number
  body_bytes_after: number
  files: string[]
}

/**
 * Moves every base64 image held inline in an activity's body_data (an <img>
 * pasted into a question, an option's imageUrl) into a file in the activity's
 * folder, and points body_data at the file. The text is otherwise unchanged.
 * The same image twice becomes one file.
 */
export async function moveInlineImagesToFiles(activityId: string): Promise<MovedInlineImages> {
  const activity = await readActivityForFiles(activityId)
  const before = JSON.stringify(activity.body_data ?? null)
  const images = new Map<string, { extension: string; data: string }>()
  for (const match of before.matchAll(INLINE_IMAGE)) {
    const data = match[2].replace(/\s+/g, '')
    const name = `image-${createHash('sha256').update(data).digest('hex').slice(0, 12)}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
    images.set(name, { extension: match[1], data })
  }
  if (images.size === 0) {
    return { activity_id: activityId, images_moved: 0, body_bytes_before: before.length, body_bytes_after: before.length, files: [] }
  }

  const urls = new Map<string, string>()
  for (const [name, image] of images) {
    const stored = await storeActivityImage(activity, activityId, name, Buffer.from(image.data, 'base64'))
    urls.set(image.data, stored.url)
  }
  const after = before.replace(INLINE_IMAGE, (whole, _ext: string, data: string) => urls.get(data.replace(/\s+/g, '')) ?? whole)

  // Compare-and-set: an edit made while the files were written is not overwritten.
  const { rowCount } = await query(
    'update activities set body_data = $2::jsonb where activity_id = $1 and body_data::jsonb = $3::jsonb',
    [activityId, after, before],
  )
  if (!rowCount) throw new Error(`Activity ${activityId} changed while its images were moved; run it again`)

  return {
    activity_id: activityId,
    images_moved: images.size,
    body_bytes_before: before.length,
    body_bytes_after: after.length,
    files: [...images.keys()],
  }
}

// The body shapes the app checks before saving a question, so a patch or a
// type change cannot leave a question the app will not render.
const QUESTION_BODY_SCHEMAS: Record<string, typeof McqActivityBodySchema | typeof ShortTextActivityBodySchema> = {
  'multiple-choice-question': McqActivityBodySchema,
  'short-text-question': ShortTextActivityBodySchema,
}

function validateActivityBody(type: string, bodyData: unknown) {
  const schema = QUESTION_BODY_SCHEMAS[type]
  if (schema) {
    const parsed = schema.safeParse(bodyData)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = fieldName(issue.path)
      throw new ActivityBodyDataError('INVALID_BODY_DATA', field, `${field}: ${issue.message} (a ${type} needs ${type === 'short-text-question' ? 'question and modelAnswer' : 'question, 2–4 options and a correctOptionId naming one of them'})`)
    }
    return
  }
  if (type === 'show-video') {
    const fileUrl = (bodyData as Record<string, unknown> | null)?.fileUrl
    if (typeof fileUrl !== 'string' || !/^https?:\/\//i.test(fileUrl)) {
      throw new ActivityBodyDataError('INVALID_BODY_DATA', 'body_data.fileUrl', 'body_data.fileUrl: a show-video activity needs { "fileUrl": "https://…" }, the video\'s link')
    }
    return
  }
  validateBodyDataForType(type, bodyData)
}

/** Shallow merge: a key set to null is removed. */
function patchBody(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key]
    else base[key] = value
  }
  return base
}

export type ActivityUpdate = {
  title?: string | null
  /** Replaces body_data as a whole. */
  bodyData?: unknown
  /** Merged into the stored body_data, so large fields need not be sent back. */
  bodyPatch?: Record<string, unknown>
  isSummative?: boolean
  type?: ActivityType
}

export async function updateActivity(activityId: string, fields: ActivityUpdate): Promise<ActivitySummary> {
  if ('bodyData' in fields && fields.bodyPatch) {
    throw new Error('Pass either body_data (replaces the whole body) or a patch, not both')
  }

  return withDbClient(async (client) => {
    await client.query('begin')
    try {
      const { rows: existing } = await client.query<{ type: string; body_data: unknown; is_summative: boolean | null }>(
        'select type, body_data, is_summative from activities where activity_id = $1 for update',
        [activityId],
      )
      const current = existing[0]
      if (!current) throw new Error(`Activity ${activityId} not found`)

      const type = fields.type ?? current.type
      const typeChanged = type !== current.type
      const scorable = (SCORABLE_ACTIVITY_TYPES as readonly string[]).includes(type)
      if (typeChanged) {
        if (isMothballedActivityType(type)) throw new Error(`"${type}" cannot be chosen for an activity`)
        const { rows: work } = await client.query<{ n: number }>('select count(*)::int as n from submissions where activity_id = $1', [activityId])
        if (work[0].n > 0) {
          throw new Error(`Activity ${activityId} has ${work[0].n} pupil submission(s) as a ${current.type}; its type cannot change. Create a new activity instead.`)
        }
      }

      const bodyChanged = 'bodyData' in fields || Boolean(fields.bodyPatch)
      const body = 'bodyData' in fields ? fields.bodyData ?? null : fields.bodyPatch ? patchBody(current.body_data, fields.bodyPatch) : current.body_data
      if (bodyChanged || typeChanged) validateActivityBody(type, body)

      if (fields.isSummative === true && !scorable) {
        throw new Error(`Only scorable activity types can be marked as summative. "${type}" is non-scorable.`)
      }

      const setClauses: string[] = []
      const values: unknown[] = []
      const set = (column: string, value: unknown) => {
        values.push(value)
        setClauses.push(`${column} = $${values.length}`)
      }
      if ('title' in fields) set('title', fields.title?.trim() ?? null)
      if (bodyChanged) set('body_data', body != null ? JSON.stringify(body) : null)
      if (fields.isSummative !== undefined) set('is_summative', fields.isSummative)
      if (typeChanged) {
        set('type', type)
        if (!scorable && fields.isSummative === undefined) set('is_summative', false)
        // Out of the app's default until criteria, pairs or items say otherwise.
        set('max_marks', type === 'short-text-question' ? 3 : 1)
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
      // New pairs, items or a new type change what the activity is out of.
      if (bodyChanged || typeChanged) {
        if (typeChanged) await recalculateActivityMaxMarks(client, activityId)
        await recalculateMatcherMaxMarks(client, activityId)
        await recalculateGroupItemsMaxMarks(client, activityId)
      }
      await client.query('commit')
      return {
        activity_id: row.activity_id,
        lesson_id: row.lesson_id,
        title: row.title,
        type: row.type,
        order_index: row.order_by,
        is_summative: row.is_summative ?? false,
        active: row.active ?? true,
      }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}

/** Matcher and group-items marks come from their pairs and items, not a tariff. */
const MAX_MARKS_FROM_BODY_TYPES = ['matcher', 'group-items']

function assertMaxMarksSettable(type: string, maxMarks: number) {
  if (!Number.isInteger(maxMarks) || maxMarks < 1) {
    throw new Error(`max_marks must be a whole number of at least 1 (received ${maxMarks})`)
  }
  if (!(SCORABLE_ACTIVITY_TYPES as readonly string[]).includes(type)) {
    throw new Error(`"${type}" is not scorable, so it has no max_marks`)
  }
  if (MAX_MARKS_FROM_BODY_TYPES.includes(type)) {
    throw new Error(`A ${type} is worth one mark per ${type === 'matcher' ? 'pair' : 'item'}; its max_marks is set from body_data, not by hand`)
  }
}

export type ActivityMaxMarksResult = {
  activity_id: string
  type: string
  title: string | null
  previous_max_marks: number | null
  max_marks: number
  rescaled_submissions: number
}

/**
 * Sets the marks an activity is out of. Marks pupils already hold are rescaled
 * with it, as the app does, so full marks stay full marks.
 *
 * Refused when success criteria are linked: max_marks is then derived from
 * them and would be overwritten on the next criterion change.
 */
export async function setActivityMaxMarks(activityId: string, maxMarks: number): Promise<ActivityMaxMarksResult> {
  return withDbClient(async (client) => {
    await client.query('begin')
    try {
      const { rows } = await client.query<{ type: string; title: string | null; max_marks: number | null; criteria: number }>(
        `select a.type, a.title, a.max_marks,
                (select count(*)::int from activity_success_criteria acs where acs.activity_id = a.activity_id) as criteria
           from activities a
          where a.activity_id = $1
          for update`,
        [activityId],
      )
      const activity = rows[0]
      if (!activity) throw new Error(`Activity ${activityId} not found`)
      assertMaxMarksSettable(activity.type, maxMarks)
      if (activity.criteria > 0) {
        throw new Error(
          `Activity has ${activity.criteria} success criteria linked, so its max_marks (${activity.max_marks}) is derived from them. `
          + 'Change the criteria (binary = 1 mark, levelled = 1 per descriptor) instead.',
        )
      }

      const { rowCount } = await client.query('select 1 from submissions where activity_id = $1', [activityId])
      await client.query('update activities set max_marks = $2 where activity_id = $1', [activityId, maxMarks])
      await rescaleStoredMarks(client, activityId, activity.max_marks, maxMarks)
      await client.query('commit')

      return {
        activity_id: activityId,
        type: activity.type,
        title: activity.title,
        previous_max_marks: activity.max_marks,
        max_marks: maxMarks,
        rescaled_submissions: activity.max_marks === maxMarks ? 0 : (rowCount ?? 0),
      }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
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
    const { rows: actRows } = await client.query<{ activity_id: string }>(
      'select activity_id from activities where activity_id = $1 limit 1',
      [activityId],
    )
    if (!actRows[0]) throw new Error(`Activity ${activityId} not found`)
    await assertScAllowedForActivity(client, activityId, successCriteriaId)

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

    await recalculateActivityMaxMarks(client, activityId)
    await recalculateMatcherMaxMarks(client, activityId)
    await recalculateGroupItemsMaxMarks(client, activityId)

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
    await assertLessonExists(client, lessonId)

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

// The list must name every active activity in the lesson exactly once, so a
// partial list cannot leave two activities sharing a position. Inactive
// activities keep their relative order after the active ones.
export async function reorderActivities(
  lessonId: string,
  activityIds: string[],
): Promise<ActivitySummary[]> {
  const duplicates = activityIds.filter((id, index) => activityIds.indexOf(id) !== index)
  if (duplicates.length > 0) {
    throw new Error(`Activity listed more than once: ${[...new Set(duplicates)].join(', ')}`)
  }

  await withDbClient(async (client) => {
    await assertLessonExists(client, lessonId)

    const { rows } = await client.query<{ activity_id: string; active: boolean | null }>(
      'select activity_id, active from activities where lesson_id = $1 order by order_by asc nulls last, title asc',
      [lessonId],
    )
    const activeIds = rows.filter((row) => row.active !== false).map((row) => row.activity_id)
    const inactiveIds = rows.filter((row) => row.active === false).map((row) => row.activity_id)

    const unknown = activityIds.filter((id) => !activeIds.includes(id))
    if (unknown.length > 0) {
      throw new Error(`Not active activities of lesson ${lessonId}: ${unknown.join(', ')}`)
    }
    const missing = activeIds.filter((id) => !activityIds.includes(id))
    if (missing.length > 0) {
      throw new Error(`Every active activity must be listed. Missing: ${missing.join(', ')}`)
    }

    const ordered = [...activityIds, ...inactiveIds]
    await client.query('begin')
    try {
      await client.query(
        `update activities a
         set order_by = o.position - 1
         from unnest($2::text[]) with ordinality as o(activity_id, position)
         where a.activity_id = o.activity_id and a.lesson_id = $1`,
        [lessonId, ordered],
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })

  return listActivitiesForLesson(lessonId)
}

export async function removeSuccessCriterionFromActivity(
  activityId: string,
  successCriteriaId: string,
): Promise<{ activity_id: string; success_criteria_id: string; removed: boolean }> {
  let removed = false
  await withDbClient(async (client) => {
    const { rowCount } = await client.query(
      'delete from activity_success_criteria where activity_id = $1 and success_criteria_id = $2',
      [activityId, successCriteriaId],
    )
    removed = (rowCount ?? 0) > 0

    if (removed) {
      await recalculateActivityMaxMarks(client, activityId)
      await recalculateMatcherMaxMarks(client, activityId)
      await recalculateGroupItemsMaxMarks(client, activityId)
    }
  })
  return { activity_id: activityId, success_criteria_id: successCriteriaId, removed }
}
