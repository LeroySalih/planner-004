import { query, withDbClient } from '@/lib/db'
import { SCORABLE_ACTIVITY_TYPES, NON_SCORABLE_ACTIVITY_TYPES } from '@/dino.config'

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

  let result: ActivitySummary | null = null

  await withDbClient(async (client) => {
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

export async function removeActivity(
  activityId: string,
  lessonId: string,
): Promise<{ activity_id: string; lesson_id: string }> {
  await withDbClient(async (client) => {
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
