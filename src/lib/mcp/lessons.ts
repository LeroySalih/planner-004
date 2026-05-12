import { query, withDbClient } from '@/lib/db'

export type LessonSummary = {
  lesson_id: string
  unit_id: string
  title: string
  is_active: boolean
  order_index: number
}

export async function listLessonsForUnit(unitId: string): Promise<LessonSummary[]> {
  const { rows } = await query(
    `SELECT lesson_id, unit_id, title, active, order_by
     FROM lessons
     WHERE unit_id = $1
     ORDER BY order_by ASC NULLS LAST, title ASC`,
    [unitId],
  )

  return (rows ?? []).map((row, index) => {
    const rawOrder = row.order_by
    const numericOrder =
      typeof rawOrder === 'number'
        ? rawOrder
        : typeof rawOrder === 'string'
          ? Number.parseInt(rawOrder, 10)
          : null

    return {
      lesson_id: typeof row.lesson_id === 'string' ? row.lesson_id : String(row.lesson_id ?? ''),
      unit_id: typeof row.unit_id === 'string' ? row.unit_id : String(row.unit_id ?? ''),
      title: typeof row.title === 'string' ? row.title : '',
      is_active: row.active === true,
      order_index: Number.isFinite(numericOrder) ? (numericOrder as number) : index,
    }
  })
}

export type LessonRecord = {
  lesson_id: string
  unit_id: string
  title: string
  is_active: boolean
  order_index: number
}

export async function createLesson(unitId: string, title: string): Promise<LessonRecord> {
  let result: LessonRecord | null = null

  await withDbClient(async (client) => {
    const { rows: maxRows } = await client.query<{ order_by: number }>(
      'select order_by from lessons where unit_id = $1 order by order_by desc nulls last limit 1',
      [unitId],
    )
    const nextOrder = (maxRows[0]?.order_by ?? -1) + 1

    const { rows } = await client.query<{
      lesson_id: string
      unit_id: string
      title: string
      active: boolean
      order_by: number
    }>(
      `insert into lessons (unit_id, title, active, order_by)
       values ($1, $2, true, $3)
       returning lesson_id, unit_id, title, active, order_by`,
      [unitId, title.trim(), nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create lesson')
    result = {
      lesson_id: row.lesson_id,
      unit_id: row.unit_id,
      title: row.title,
      is_active: row.active,
      order_index: row.order_by,
    }
  })

  if (!result) throw new Error('Failed to create lesson')
  return result
}
