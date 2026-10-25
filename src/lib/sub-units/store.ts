import type { PoolClient } from "pg"
import { z } from "zod"

import { query, withDbClient } from "@/lib/db"
import { LESSON_DESCRIPTION_MAX } from "@/lib/lesson-description"
import { SubUnitSchema, type SubUnit } from "@/types"

// Sub units group a unit's lessons for planning (migration 126). They are
// structure only: reports and progress never read them. Shared by the unit
// page's server actions and the MCP server, which carries no session, so
// callers do their own authorisation.
//
// One rule holds the layout together: a sub unit's lessons sit next to each
// other in the unit's single lesson order, with the sub unit placed where its
// first lesson is. The unit page and My Units both rely on it, so every write
// here that can split a sub unit ends with normaliseLessonGrouping.

export const SubUnitTitleSchema = z.string().trim().min(1, "Give the sub unit a title.").max(255)

export const SubUnitDescriptionSchema = z
  .string()
  .trim()
  .max(LESSON_DESCRIPTION_MAX, `Keep the description to ${LESSON_DESCRIPTION_MAX} characters.`)
  .transform((value) => value || null)

export type SubUnitLessonsChoice = "deactivate" | "ungroup"

export type SubUnitWithLessons = SubUnit & {
  lessons: { lesson_id: string; title: string; is_active: boolean; order_index: number }[]
}

const SUB_UNIT_COLUMNS = "sub_unit_id, unit_id, title, description, active"

export async function listSubUnits(unitId: string): Promise<SubUnit[]> {
  const { rows } = await query(
    `select ${SUB_UNIT_COLUMNS} from sub_units where unit_id = $1 order by created_at, title`,
    [unitId],
  )
  return z.array(SubUnitSchema).parse(rows)
}

/** Sub units with their lessons, in the unit's lesson order. */
export async function listSubUnitsWithLessons(unitId: string): Promise<SubUnitWithLessons[]> {
  const [subUnits, { rows }] = await Promise.all([
    listSubUnits(unitId),
    query<{ lesson_id: string; title: string; active: boolean | null; order_by: number; sub_unit_id: string }>(
      `select lesson_id, title, active, order_by, sub_unit_id from lessons
        where unit_id = $1 and kind = 'standard' and sub_unit_id is not null
        order by order_by, lesson_id`,
      [unitId],
    ),
  ])
  return subUnits.map((subUnit) => ({
    ...subUnit,
    lessons: rows
      .filter((row) => row.sub_unit_id === subUnit.sub_unit_id)
      .map((row) => ({ lesson_id: row.lesson_id, title: row.title, is_active: row.active !== false, order_index: row.order_by })),
  }))
}

export async function createSubUnit(unitId: string, title: string, description?: string | null): Promise<SubUnit> {
  const cleanTitle = SubUnitTitleSchema.parse(title)
  const cleanDescription = SubUnitDescriptionSchema.parse(description ?? "")
  const { rows: unit } = await query("select 1 from units where unit_id = $1", [unitId])
  if (!unit[0]) throw new Error(`Unit ${unitId} not found`)
  const { rows } = await query(
    `insert into sub_units (unit_id, title, description) values ($1, $2, $3) returning ${SUB_UNIT_COLUMNS}`,
    [unitId, cleanTitle, cleanDescription],
  )
  return SubUnitSchema.parse(rows[0])
}

/** Change a title and/or description. Omitted fields are left as they are; "" clears the description. */
export async function updateSubUnit(
  subUnitId: string,
  changes: { title?: string; description?: string | null },
): Promise<SubUnit> {
  const title = changes.title === undefined ? null : SubUnitTitleSchema.parse(changes.title)
  const description = changes.description === undefined ? undefined : SubUnitDescriptionSchema.parse(changes.description ?? "")
  const { rows } = await query(
    `update sub_units
        set title = coalesce($2, title),
            description = case when $3 then $4 else description end,
            updated_at = now()
      where sub_unit_id = $1
      returning ${SUB_UNIT_COLUMNS}`,
    [subUnitId, title, description !== undefined, description ?? null],
  )
  if (!rows[0]) throw new Error(`Sub unit ${subUnitId} not found`)
  return SubUnitSchema.parse(rows[0])
}

/**
 * Switch a sub unit on or off. Switching off needs a decision about its
 * lessons: `deactivate` makes them inactive too and keeps them grouped, so
 * switching the sub unit back on finds them where they were; `ungroup`
 * returns them, still active, to the unit level.
 */
export async function setSubUnitActive(
  subUnitId: string,
  active: boolean,
  lessons: SubUnitLessonsChoice = "ungroup",
): Promise<SubUnit> {
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `update sub_units set active = $2, updated_at = now()
        where sub_unit_id = $1
        returning ${SUB_UNIT_COLUMNS}`,
      [subUnitId, active],
    )
    if (!rows[0]) throw new Error(`Sub unit ${subUnitId} not found`)
    if (!active) {
      await client.query(
        lessons === "deactivate"
          ? "update lessons set active = false where sub_unit_id = $1"
          : "update lessons set sub_unit_id = null where sub_unit_id = $1",
        [subUnitId],
      )
    }
    return SubUnitSchema.parse(rows[0])
  })
}

/**
 * Put a lesson in a sub unit of its own unit, or take it out (null). It
 * joins at the end of the sub unit; taken out, it sits just after it.
 */
export async function setLessonSubUnit(lessonId: string, subUnitId: string | null): Promise<{ unit_id: string }> {
  return inTransaction(async (client) => {
    const { rows } = await client.query<{ unit_id: string; sub_unit_id: string | null; kind: string }>(
      "select unit_id, sub_unit_id, kind from lessons where lesson_id = $1 for update",
      [lessonId],
    )
    const lesson = rows[0]
    if (!lesson) throw new Error(`Lesson ${lessonId} not found`)
    if (lesson.kind !== "standard") throw new Error("Interventions cannot be grouped into sub units.")
    if (subUnitId) {
      const { rows: found } = await client.query<{ unit_id: string }>(
        "select unit_id from sub_units where sub_unit_id = $1",
        [subUnitId],
      )
      if (!found[0]) throw new Error(`Sub unit ${subUnitId} not found`)
      if (found[0].unit_id !== lesson.unit_id) {
        throw new Error(`Sub unit ${subUnitId} belongs to unit ${found[0].unit_id}, not this lesson's unit ${lesson.unit_id}.`)
      }
    }
    const anchor = subUnitId ?? lesson.sub_unit_id
    await client.query("update lessons set sub_unit_id = $2 where lesson_id = $1", [lessonId, subUnitId])
    await normaliseLessonGrouping(client, lesson.unit_id, { lessonId, after: anchor })
    return { unit_id: lesson.unit_id }
  })
}

/**
 * Renumber a unit's lessons so each sub unit's lessons are together, at the
 * place of its first lesson, keeping every other relative order. With
 * `moved`, that lesson is first lifted out and placed after the last lesson
 * of sub unit `after` (where it joined, or the one it left).
 */
export async function normaliseLessonGrouping(
  client: PoolClient,
  unitId: string,
  moved?: { lessonId: string; after: string | null },
): Promise<void> {
  const { rows } = await client.query<{ lesson_id: string; sub_unit_id: string | null; order_by: number }>(
    `select lesson_id, sub_unit_id, order_by from lessons
      where unit_id = $1 and kind = 'standard'
      order by order_by, lesson_id`,
    [unitId],
  )
  let lessons = rows
  if (moved?.after) {
    const lifted = lessons.find((row) => row.lesson_id === moved.lessonId)
    const rest = lessons.filter((row) => row.lesson_id !== moved.lessonId)
    const lastIndex = rest.map((row) => row.sub_unit_id).lastIndexOf(moved.after)
    if (lifted && lastIndex !== -1) {
      lessons = [...rest.slice(0, lastIndex + 1), lifted, ...rest.slice(lastIndex + 1)]
    }
  }

  const items: { lessons: typeof lessons }[] = []
  const groups = new Map<string, typeof lessons>()
  for (const lesson of lessons) {
    const group = lesson.sub_unit_id ? groups.get(lesson.sub_unit_id) : undefined
    if (group) {
      group.push(lesson)
      continue
    }
    const fresh = [lesson]
    if (lesson.sub_unit_id) groups.set(lesson.sub_unit_id, fresh)
    items.push({ lessons: fresh })
  }
  const ordered = items.flatMap((item) => item.lessons)
  if (ordered.every((lesson, index) => lesson.order_by === index)) return

  await client.query(
    `update lessons l set order_by = o.position - 1
       from unnest($2::text[]) with ordinality as o(lesson_id, position)
      where l.lesson_id = o.lesson_id and l.unit_id = $1`,
    [unitId, ordered.map((lesson) => lesson.lesson_id)],
  )
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withDbClient(async (client) => {
    await client.query("begin")
    try {
      const result = await fn(client)
      await client.query("commit")
      return result
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  })
}
