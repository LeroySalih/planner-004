"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireTeacherProfile } from "@/lib/auth"
import { withDbClient } from "@/lib/db"
import {
  createSubUnit,
  listSubUnits,
  setSubUnitActive,
  updateSubUnit,
  type SubUnitLessonsChoice,
} from "@/lib/sub-units/store"
import type { SubUnit } from "@/types"

// Sub units group a unit's lessons for planning (migration 126). The rules
// live in src/lib/sub-units/store.ts, shared with the MCP server.

const ArrangementSchema = z.array(
  z.object({
    lessonId: z.string().min(1),
    orderBy: z.number().int(),
    subUnitId: z.string().min(1).nullable(),
  }),
)

function failure(error: unknown, fallback: string) {
  console.error(`[sub-units] ${fallback}`, error)
  const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : null
  return { data: null, error: message ?? fallback }
}

export async function readSubUnitsByUnitAction(
  unitId: string,
): Promise<{ data: SubUnit[] | null; error: string | null }> {
  await requireTeacherProfile()
  try {
    return { data: await listSubUnits(unitId), error: null }
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
    const subUnit = await createSubUnit(unitId, input.title, input.description)
    revalidatePath(`/units/${unitId}`)
    return { data: subUnit, error: null }
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
    const subUnit = await updateSubUnit(subUnitId, { title: input.title, description: input.description ?? "" })
    revalidatePath(`/units/${subUnit.unit_id}`)
    return { data: subUnit, error: null }
  } catch (error) {
    return failure(error, "Unable to update the sub unit.")
  }
}

export async function setSubUnitActiveAction(
  subUnitId: string,
  active: boolean,
  lessons: SubUnitLessonsChoice = "ungroup",
): Promise<{ data: SubUnit | null; error: string | null }> {
  await requireTeacherProfile()
  try {
    const subUnit = await setSubUnitActive(subUnitId, active, lessons)
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
