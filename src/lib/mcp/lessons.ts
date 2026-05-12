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

export type LessonScLinkResult = {
  lesson_id: string
  success_criteria_id: string
  learning_objective_id: string
  lo_already_linked: boolean
  sc_already_linked: boolean
}

export async function addSuccessCriterionToLesson(
  lessonId: string,
  successCriteriaId: string,
): Promise<LessonScLinkResult> {
  let result: LessonScLinkResult | null = null

  await withDbClient(async (client) => {
    // Validate lesson exists
    const { rows: lessonRows } = await client.query<{ lesson_id: string }>(
      'select lesson_id from lessons where lesson_id = $1 limit 1',
      [lessonId],
    )
    if (!lessonRows[0]) throw new Error(`Lesson ${lessonId} not found`)

    // Validate SC exists and get its learning_objective_id
    const { rows: scRows } = await client.query<{ success_criteria_id: string; learning_objective_id: string }>(
      'select success_criteria_id, learning_objective_id from success_criteria where success_criteria_id = $1 limit 1',
      [successCriteriaId],
    )
    if (!scRows[0]) throw new Error(`Success criterion ${successCriteriaId} not found`)
    const learningObjectiveId = scRows[0].learning_objective_id

    // Insert SC link (skip if already linked)
    const { rowCount: scInserted } = await client.query(
      `insert into lesson_success_criteria (lesson_id, success_criteria_id)
       values ($1, $2)
       on conflict do nothing`,
      [lessonId, successCriteriaId],
    )
    const scAlreadyLinked = (scInserted ?? 0) === 0

    // Check if LO already linked
    const { rows: existingLoRows } = await client.query<{ learning_objective_id: string }>(
      'select learning_objective_id from lessons_learning_objective where lesson_id = $1 and learning_objective_id = $2 limit 1',
      [lessonId, learningObjectiveId],
    )
    const loAlreadyLinked = existingLoRows.length > 0

    if (!loAlreadyLinked) {
      // Get LO title and next order_by
      const { rows: loRows } = await client.query<{ title: string }>(
        'select title from learning_objectives where learning_objective_id = $1 limit 1',
        [learningObjectiveId],
      )
      const loTitle = loRows[0]?.title ?? ''

      const { rows: maxRows } = await client.query<{ order_by: number }>(
        'select order_by from lessons_learning_objective where lesson_id = $1 order by order_by desc nulls last limit 1',
        [lessonId],
      )
      const nextOrder = (maxRows[0]?.order_by ?? -1) + 1

      await client.query(
        `insert into lessons_learning_objective (lesson_id, learning_objective_id, order_by, title, active)
         values ($1, $2, $3, $4, true)`,
        [lessonId, learningObjectiveId, nextOrder, loTitle],
      )
    }

    result = {
      lesson_id: lessonId,
      success_criteria_id: successCriteriaId,
      learning_objective_id: learningObjectiveId,
      lo_already_linked: loAlreadyLinked,
      sc_already_linked: scAlreadyLinked,
    }
  })

  if (!result) throw new Error('Failed to link success criterion to lesson')
  return result
}
