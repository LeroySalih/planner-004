import { query, withDbClient } from '@/lib/db'
import { assertUnitExists, assertLessonExists } from '@/lib/mcp/guards'
import { assertScAllowedForLesson, assertLoAllowedForLesson } from '@/lib/curriculum/unit-curriculum-guard'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { MCP_UPLOAD_MAX_BYTES } from '@/lib/mcp/file-input'
import { cleanLessonDescription as cleanDescription } from '@/lib/lesson-description'

export type LessonSummary = {
  lesson_id: string
  unit_id: string
  title: string
  description: string | null
  is_active: boolean
  order_index: number
}


export async function listLessonsForUnit(unitId: string): Promise<LessonSummary[]> {
  const { rows } = await query(
    `SELECT lesson_id, unit_id, title, description, active, order_by
     FROM lessons
     WHERE unit_id = $1 AND kind = 'standard'
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
      description: typeof row.description === 'string' ? row.description : null,
      is_active: row.active !== false,
      order_index: Number.isFinite(numericOrder) ? (numericOrder as number) : index,
    }
  })
}

export type LessonRecord = {
  lesson_id: string
  unit_id: string
  title: string
  description: string | null
  is_active: boolean
  order_index: number
}

export async function createLesson(unitId: string, title: string, description?: string): Promise<LessonRecord> {
  let result: LessonRecord | null = null
  const cleanedDescription = description === undefined ? null : cleanDescription(description)

  await withDbClient(async (client) => {
    await assertUnitExists(client, unitId)

    const { rows: maxRows } = await client.query<{ order_by: number }>(
      'select order_by from lessons where unit_id = $1 order by order_by desc nulls last limit 1',
      [unitId],
    )
    const nextOrder = (maxRows[0]?.order_by ?? -1) + 1

    const { rows } = await client.query<{
      lesson_id: string
      unit_id: string
      title: string
      description: string | null
      active: boolean
      order_by: number
    }>(
      `insert into lessons (unit_id, title, description, active, order_by)
       values ($1, $2, $3, true, $4)
       returning lesson_id, unit_id, title, description, active, order_by`,
      [unitId, title.trim(), cleanedDescription, nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create lesson')
    result = {
      lesson_id: row.lesson_id,
      unit_id: row.unit_id,
      title: row.title,
      description: row.description,
      is_active: row.active,
      order_index: row.order_by,
    }
  })

  if (!result) throw new Error('Failed to create lesson')
  return result
}

/** Omitted fields are left unchanged; an empty description clears it. */
export async function updateLesson(
  lessonId: string,
  updates: { title?: string; description?: string },
): Promise<LessonRecord> {
  const title = updates.title?.trim()
  if (updates.title !== undefined && !title) throw new Error('Lesson title cannot be empty')
  if (title === undefined && updates.description === undefined) {
    throw new Error('Nothing to update: pass title and/or description')
  }
  const description = updates.description === undefined ? undefined : cleanDescription(updates.description)

  const { rows } = await query<{
    lesson_id: string
    unit_id: string
    title: string
    description: string | null
    active: boolean | null
    order_by: number
  }>(
    `update lessons
        set title = coalesce($2, title),
            description = case when $3 then $4 else description end
      where lesson_id = $1
      returning lesson_id, unit_id, title, description, active, order_by`,
    [lessonId, title ?? null, description !== undefined, description ?? null],
  )
  const row = rows[0]
  if (!row) throw new Error(`Lesson ${lessonId} not found`)
  return {
    lesson_id: row.lesson_id,
    unit_id: row.unit_id,
    title: row.title,
    description: row.description,
    is_active: row.active !== false,
    order_index: row.order_by,
  }
}

// Mirrors reorderActivities: the list must name every active lesson in the
// unit exactly once, so a partial list cannot leave two lessons sharing a
// position. Inactive lessons keep their relative order after the active ones.
// Interventions are one pupil's lessons, not part of the unit's sequence, and
// are left alone.
export async function reorderLessons(unitId: string, lessonIds: string[]): Promise<LessonSummary[]> {
  const duplicates = lessonIds.filter((id, index) => lessonIds.indexOf(id) !== index)
  if (duplicates.length > 0) {
    throw new Error(`Lesson listed more than once: ${[...new Set(duplicates)].join(', ')}`)
  }

  await withDbClient(async (client) => {
    await assertUnitExists(client, unitId)

    const { rows } = await client.query<{ lesson_id: string; active: boolean | null }>(
      `select lesson_id, active from lessons
        where unit_id = $1 and kind = 'standard'
        order by order_by asc nulls last, title asc`,
      [unitId],
    )
    const activeIds = rows.filter((row) => row.active !== false).map((row) => row.lesson_id)
    const inactiveIds = rows.filter((row) => row.active === false).map((row) => row.lesson_id)

    const unknown = lessonIds.filter((id) => !activeIds.includes(id))
    if (unknown.length > 0) {
      throw new Error(`Not active lessons of unit ${unitId}: ${unknown.join(', ')}`)
    }
    const missing = activeIds.filter((id) => !lessonIds.includes(id))
    if (missing.length > 0) {
      throw new Error(`Every active lesson must be listed. Missing: ${missing.join(', ')}`)
    }

    await client.query('begin')
    try {
      await client.query(
        `update lessons l
         set order_by = o.position - 1
         from unnest($2::text[]) with ordinality as o(lesson_id, position)
         where l.lesson_id = o.lesson_id and l.unit_id = $1`,
        [unitId, [...lessonIds, ...inactiveIds]],
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })

  return listLessonsForUnit(unitId)
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
    await assertLessonExists(client, lessonId)
    await assertScAllowedForLesson(client, lessonId, successCriteriaId)

    // Validate SC exists and get its learning_objective_id
    const { rows: scRows } = await client.query<{ success_criteria_id: string; learning_objective_id: string }>(
      'select success_criteria_id, learning_objective_id from success_criteria where success_criteria_id = $1 limit 1',
      [successCriteriaId],
    )
    if (!scRows[0]) throw new Error(`Success criterion ${successCriteriaId} not found`)
    const learningObjectiveId = scRows[0].learning_objective_id
    await assertLoAllowedForLesson(client, lessonId, learningObjectiveId)

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

const LESSON_FILES_BUCKET = 'lessons'

export type LessonFileResult = {
  lesson_id: string
  file_name: string
  size_bytes: number
  url: string
}

export async function uploadLessonFile(
  lessonId: string,
  fileName: string,
  buffer: Buffer,
  contentType?: string | null,
): Promise<LessonFileResult> {
  if (buffer.byteLength > MCP_UPLOAD_MAX_BYTES) {
    throw new Error(`File exceeds the 5 MB limit (${buffer.byteLength} bytes)`)
  }

  await withDbClient((client) => assertLessonExists(client, lessonId))

  const fullPath = `${lessonId}/${fileName}`
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { error } = await storage.upload(fullPath, buffer, {
    contentType: contentType ?? 'application/octet-stream',
    originalPath: fullPath,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const urlParts = [LESSON_FILES_BUCKET, lessonId, fileName].map(encodeURIComponent).join('/')
  return {
    lesson_id: lessonId,
    file_name: fileName,
    size_bytes: buffer.byteLength,
    url: `/api/files/${urlParts}`,
  }
}

export async function removeSuccessCriterionFromLesson(
  lessonId: string,
  successCriteriaId: string,
): Promise<{ lesson_id: string; success_criteria_id: string; removed: boolean }> {
  let removed = false
  await withDbClient(async (client) => {
    const { rowCount } = await client.query(
      'delete from lesson_success_criteria where lesson_id = $1 and success_criteria_id = $2',
      [lessonId, successCriteriaId],
    )
    removed = (rowCount ?? 0) > 0
  })
  return { lesson_id: lessonId, success_criteria_id: successCriteriaId, removed }
}

export type LessonObjectives = {
  lesson_id: string
  unit_id: string
  title: string
  description: string | null
  learning_objectives: Array<{
    learning_objective_id: string
    assessment_objective_code: string | null
    title: string
    active: boolean
    /** False when only a criterion links this LO, not the lesson itself. */
    linked_to_lesson: boolean
    success_criteria: Array<{
      success_criteria_id: string
      description: string
      level: number
      active: boolean
      /** False when only an activity in this lesson uses the criterion. */
      linked_to_lesson: boolean
      activities: Array<{ activity_id: string; title: string; type: string }>
    }>
  }>
}

/**
 * Everything linked to a lesson: its learning objectives, its success
 * criteria grouped under their LO, and which of the lesson's activities use
 * each criterion. Criteria that only an activity links are included and
 * flagged, so a stale link is visible rather than hidden.
 */
export async function getLessonObjectives(lessonId: string): Promise<LessonObjectives> {
  const { rows: lessonRows } = await query<{ lesson_id: string; unit_id: string; title: string; description: string | null }>(
    'select lesson_id, unit_id, title, description from lessons where lesson_id = $1 limit 1',
    [lessonId],
  )
  const lesson = lessonRows[0]
  if (!lesson) throw new Error(`Lesson ${lessonId} not found`)

  const { rows: loRows } = await query<{ learning_objective_id: string; order_by: number | null }>(
    'select learning_objective_id, order_by from lessons_learning_objective where lesson_id = $1',
    [lessonId],
  )
  const lessonLoOrder = new Map(loRows.map((row) => [row.learning_objective_id, row.order_by ?? 0]))

  const { rows: scRows } = await query<{
    success_criteria_id: string
    learning_objective_id: string
    description: string
    level: number
    active: boolean | null
    order_index: number
    linked_to_lesson: boolean
    activities: Array<{ activity_id: string; title: string; type: string }>
  }>(
    `with lesson_activities as (
       select activity_id, coalesce(title, '') as title, type, order_by from activities where lesson_id = $1 and active is not false
     ), linked as (
       select success_criteria_id from lesson_success_criteria where lesson_id = $1
       union
       select asc_.success_criteria_id
         from activity_success_criteria asc_
         join lesson_activities la on la.activity_id = asc_.activity_id
     )
     select sc.success_criteria_id, sc.learning_objective_id, sc.description, sc.level, sc.active, sc.order_index,
            exists (select 1 from lesson_success_criteria lsc
                     where lsc.lesson_id = $1 and lsc.success_criteria_id = sc.success_criteria_id) as linked_to_lesson,
            coalesce((select json_agg(json_build_object('activity_id', la.activity_id, 'title', la.title, 'type', la.type) order by la.order_by)
                        from activity_success_criteria asc_
                        join lesson_activities la on la.activity_id = asc_.activity_id
                       where asc_.success_criteria_id = sc.success_criteria_id), '[]'::json) as activities
       from linked
       join success_criteria sc on sc.success_criteria_id = linked.success_criteria_id`,
    [lessonId],
  )

  const loIds = Array.from(new Set([...lessonLoOrder.keys(), ...scRows.map((row) => row.learning_objective_id)]))
  const { rows: loMeta } = await query<{
    learning_objective_id: string
    title: string
    active: boolean
    assessment_objective_code: string | null
  }>(
    `select lo.learning_objective_id, lo.title, lo.active, ao.code as assessment_objective_code
       from learning_objectives lo
       left join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
      where lo.learning_objective_id = any($1::text[])`,
    [loIds],
  )

  const learning_objectives = loMeta
    .map((lo) => ({
      learning_objective_id: lo.learning_objective_id,
      assessment_objective_code: lo.assessment_objective_code,
      title: lo.title,
      active: lo.active,
      linked_to_lesson: lessonLoOrder.has(lo.learning_objective_id),
      success_criteria: scRows
        .filter((sc) => sc.learning_objective_id === lo.learning_objective_id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((sc) => ({
          success_criteria_id: sc.success_criteria_id,
          description: sc.description,
          level: sc.level,
          active: sc.active !== false,
          linked_to_lesson: sc.linked_to_lesson,
          activities: sc.activities,
        })),
    }))
    .sort((a, b) =>
      (lessonLoOrder.get(a.learning_objective_id) ?? Number.MAX_SAFE_INTEGER)
      - (lessonLoOrder.get(b.learning_objective_id) ?? Number.MAX_SAFE_INTEGER))

  return {
    lesson_id: lesson.lesson_id,
    unit_id: lesson.unit_id,
    title: lesson.title,
    description: lesson.description,
    learning_objectives,
  }
}

export type LessonLoUnlinkResult = {
  lesson_id: string
  learning_objective_id: string
  /** False when the lesson linked neither the LO nor any of its criteria. */
  removed: boolean
  success_criteria_unlinked: string[]
  /** Activities in the lesson still linked to one of the LO's criteria; the LO still shows through them. */
  activities_still_linked: Array<{ activity_id: string; title: string | null; success_criteria_id: string }>
}

/**
 * Unlinks a learning objective from a lesson, with the lesson's links to the
 * LO's success criteria: a criterion left linked would show the LO again.
 * Activity links are left alone and reported, since removing them changes
 * what the activity is marked against.
 */
export async function removeLearningObjectiveFromLesson(
  lessonId: string,
  learningObjectiveId: string,
): Promise<LessonLoUnlinkResult> {
  return withDbClient(async (client) => {
    await assertLessonExists(client, lessonId)
    await client.query('begin')
    try {
      const { rows: scRows } = await client.query<{ success_criteria_id: string }>(
        `delete from lesson_success_criteria lsc
          using success_criteria sc
          where lsc.lesson_id = $1
            and sc.success_criteria_id = lsc.success_criteria_id
            and sc.learning_objective_id = $2
          returning lsc.success_criteria_id`,
        [lessonId, learningObjectiveId],
      )
      const { rowCount } = await client.query(
        'delete from lessons_learning_objective where lesson_id = $1 and learning_objective_id = $2',
        [lessonId, learningObjectiveId],
      )
      const { rows: activityRows } = await client.query<{ activity_id: string; title: string | null; success_criteria_id: string }>(
        `select a.activity_id, a.title, acs.success_criteria_id
           from activities a
           join activity_success_criteria acs on acs.activity_id = a.activity_id
           join success_criteria sc on sc.success_criteria_id = acs.success_criteria_id
          where a.lesson_id = $1 and a.active is not false and sc.learning_objective_id = $2
          order by a.order_by asc nulls last`,
        [lessonId, learningObjectiveId],
      )
      await client.query('commit')
      return {
        lesson_id: lessonId,
        learning_objective_id: learningObjectiveId,
        removed: (rowCount ?? 0) > 0 || scRows.length > 0,
        success_criteria_unlinked: scRows.map((row) => row.success_criteria_id),
        activities_still_linked: activityRows,
      }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}

/** Deletes one of a lesson's private teacher files (not an activity's). */
export async function removeLessonFile(lessonId: string, fileName: string): Promise<{ lesson_id: string; file_name: string }> {
  const { rows } = await query(
    `select 1 from stored_files where bucket = $1 and scope_path = $2 and file_name = $3 limit 1`,
    [LESSON_FILES_BUCKET, lessonId, fileName],
  )
  if (!rows[0]) {
    throw new Error(`Lesson ${lessonId} has no teacher file "${fileName}". Call list_lesson_files for the exact names (lesson files have activity_id null).`)
  }
  const { error } = await createLocalStorageClient(LESSON_FILES_BUCKET).remove([`${lessonId}/${fileName}`])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
  return { lesson_id: lessonId, file_name: fileName }
}
