"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireTeacherProfile } from "@/lib/auth"
import { query, withDbClient } from "@/lib/db"
import { LESSON_DESCRIPTION_MAX } from "@/lib/lesson-description"
import { SubUnitSchema, type SubUnit } from "@/types"

// Sub units group a unit's lessons for planning (migration 126). They are
// structure only: reports and progress never read them.

const SubUnitInputSchema = z.object({
  title: z.string().trim().min(1, "Give the sub unit a title.").max(255),
  description: z
    .string()
    .trim()
    .max(LESSON_DESCRIPTION_MAX, `Keep the description to ${LESSON_DESCRIPTION_MAX} characters.`)
    .default("")
    .transform((value) => value || null),
})

const ArrangementSchema = z.array(
  z.object({
    lessonId: z.string().min(1),
    orderBy: z.number().int(),
    subUnitId: z.string().min(1).nullable(),
  }),
)

const SUB_UNIT_COLUMNS = "sub_unit_id, unit_id, title, description, active"

function failure(error: unknown, fallback: string) {
  console.error(`[sub-units] ${fallback}`, error)
  return { data: null, error: error instanceof Error ? error.message : fallback }
}

export async function readSubUnitsByUnitAction(
  unitId: string,
): Promise<{ data: SubUnit[] | null; error: string | null }> {
  await requireTeacherProfile()
  try {
    const { rows } = await query(
      `select ${SUB_UNIT_COLUMNS} from sub_units where unit_id = $1 order by created_at, title`,
      [unitId],
    )
    return { data: z.array(SubUnitSchema).parse(rows), error: null }
  } catch (error) {
    return failure(error, "Unable to load sub units.")
  }
}

export async function createSubUnitAction(
  unitId: string,
  input: { title: string; description?: string },
): Promise<{ data: SubUnit | null; error: string | null }> {
  await requireTeacherProfile()
  try {
    const { title, description } = SubUnitInputSchema.parse(input)
    const { rows } = await query(
      `insert into sub_units (unit_id, title, description)
       values ($1, $2, $3)
       returning ${SUB_UNIT_COLUMNS}`,
      [unitId, title, description],
    )
    revalidatePath(`/units/${unitId}`)
    return { data: SubUnitSchema.parse(rows[0]), error: null }
  } catch (error) {
    return failure(error, "Unable to create the sub unit.")
  }
}

export async function updateSubUnitAction(
  subUnitId: string,
  input: { title: string; description?: string },
): Promise<{ data: SubUnit | null; error: string | null }> {
  await requireTeacherProfile()
  try {
    const { title, description } = SubUnitInputSchema.parse(input)
    const { rows } = await query(
      `update sub_units set title = $2, description = $3, updated_at = now()
        where sub_unit_id = $1
        returning ${SUB_UNIT_COLUMNS}`,
      [subUnitId, title, description],
    )
    if (!rows[0]) return { data: null, error: "Sub unit not found." }
    const subUnit = SubUnitSchema.parse(rows[0])
    revalidatePath(`/units/${subUnit.unit_id}`)
    return { data: subUnit, error: null }
  } catch (error) {
    return failure(error, "Unable to update the sub unit.")
  }
}

/**
 * Switch a sub unit on or off. Switching off needs a decision about its
 * lessons: `deactivate` makes them inactive too and keeps them grouped, so
 * switching the sub unit back on finds them where they were; `ungroup`
 * returns them, still active, to the unit level.
 */
export async function setSubUnitActiveAction(
  subUnitId: string,
  active: boolean,
  lessons: "deactivate" | "ungroup" = "ungroup",
): Promise<{ data: SubUnit | null; error: string | null }> {
  await requireTeacherProfile()
  try {
    const subUnit = await withDbClient(async (client) => {
      await client.query("begin")
      try {
        const { rows } = await client.query(
          `update sub_units set active = $2, updated_at = now()
            where sub_unit_id = $1
            returning ${SUB_UNIT_COLUMNS}`,
          [subUnitId, active],
        )
        if (!rows[0]) throw new Error("Sub unit not found.")
        if (!active) {
          await client.query(
            lessons === "deactivate"
              ? "update lessons set active = false where sub_unit_id = $1"
              : "update lessons set sub_unit_id = null where sub_unit_id = $1",
            [subUnitId],
          )
        }
        await client.query("commit")
        return SubUnitSchema.parse(rows[0])
      } catch (error) {
        await client.query("rollback")
        throw error
      }
    })
    revalidatePath(`/units/${subUnit.unit_id}`)
    return { data: subUnit, error: null }
  } catch (error) {
    return failure(error, "Unable to update the sub unit.")
  }
}

/**
 * Save the order and grouping of a unit's lessons in one go, so a lesson
 * dragged into or out of a sub unit never lands half moved. The database
 * refuses a sub unit from another unit (migration 126's composite key).
 */
export async function arrangeLessonsAction(
  unitId: string,
  arrangement: { lessonId: string; orderBy: number; subUnitId: string | null }[],
): Promise<{ success: boolean; error: string | null }> {
  await requireTeacherProfile()
  try {
    const rows = ArrangementSchema.parse(arrangement)
    if (rows.length === 0) return { success: true, error: null }
    await withDbClient(async (client) => {
      await client.query("begin")
      try {
        const { rowCount } = await client.query(
          `update lessons l
              set order_by = data.order_by, sub_unit_id = data.sub_unit_id
             from unnest($2::text[], $3::integer[], $4::text[]) as data(lesson_id, order_by, sub_unit_id)
            where l.lesson_id = data.lesson_id and l.unit_id = $1 and l.kind = 'standard'`,
          [
            unitId,
            rows.map((row) => row.lessonId),
            rows.map((row) => row.orderBy),
            rows.map((row) => row.subUnitId),
          ],
        )
        if (rowCount !== rows.length) throw new Error("Some of those lessons are not in this unit.")
        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        throw error
      }
    })
    revalidatePath(`/units/${unitId}`)
    return { success: true, error: null }
  } catch (error) {
    console.error("[sub-units] Unable to arrange lessons.", error)
    return { success: false, error: error instanceof Error ? error.message : "Unable to save the lesson order." }
  }
}
