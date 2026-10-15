import { query, withDbClient } from '@/lib/db'
import { SCORABLE_ACTIVITY_TYPES, NON_SCORABLE_ACTIVITY_TYPES, isLegacyActivityType, legacyActivityTypeMessage } from '@/dino.config'
import { assertLessonExists } from '@/lib/mcp/guards'
import { MCP_UPLOAD_MAX_BYTES } from '@/lib/mcp/file-input'
import { assertScAllowedForActivity } from '@/lib/curriculum/unit-curriculum-guard'
import { recalculateActivityMaxMarks, recalculateGroupItemsMaxMarks, recalculateMatcherMaxMarks, rescaleStoredMarks } from '@/lib/scoring/derive-max-marks'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { GroupItemsActivityBodySchema, MatcherActivityBodySchema, SequenceActivityBodySchema } from '@/types'

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

export function validateBodyDataForType(type: string, bodyData: unknown): void {
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
    // New pairs or items change what a matcher or group-items is out of.
    if ('bodyData' in fields) {
      await recalculateMatcherMaxMarks(client, activityId)
      await recalculateGroupItemsMaxMarks(client, activityId)
    }
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
