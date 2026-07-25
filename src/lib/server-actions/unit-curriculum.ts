"use server"

import { requireRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { revalidatePath } from "next/cache"

// Teacher-facing read/set for a unit's chosen curriculum. The curriculum can be
// picked freely until the unit has any curriculum LO/SC assigned; after that it
// is LOCKED (changing it must go through admin remediation, which cascades the
// removal of the other curriculum's items). Enforcement of "only this
// curriculum's items may be assigned" lives in
// src/lib/curriculum/unit-curriculum-guard.ts.

// True if the unit touches at least one (curriculum-bearing) LO/SC across any of
// the four assignment surfaces.
const UNIT_TOUCHES_CURRICULUM_SQL = `
  select exists(
    select 1 from success_criteria_units scu
      join success_criteria sc on sc.success_criteria_id = scu.success_criteria_id
      join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
      join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
     where scu.unit_id = $1 and ao.curriculum_id is not null
    union all
    select 1 from lessons l
      join lessons_learning_objective llo on llo.lesson_id = l.lesson_id
      join learning_objectives lo on lo.learning_objective_id = llo.learning_objective_id
      join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
     where l.unit_id = $1 and ao.curriculum_id is not null
    union all
    select 1 from lessons l
      join lesson_success_criteria lsc on lsc.lesson_id = l.lesson_id
      join success_criteria sc on sc.success_criteria_id = lsc.success_criteria_id
      join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
      join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
     where l.unit_id = $1 and ao.curriculum_id is not null
    union all
    select 1 from lessons l
      join activities a on a.lesson_id = l.lesson_id
      join activity_success_criteria asc2 on asc2.activity_id = a.activity_id
      join success_criteria sc on sc.success_criteria_id = asc2.success_criteria_id
      join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
      join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
     where l.unit_id = $1 and ao.curriculum_id is not null
    limit 1
  ) as touches`

export interface UnitCurriculumState {
  curriculumId: string | null
  /** Once true, the curriculum choice is fixed (items already assigned). */
  locked: boolean
}

export async function readUnitCurriculumStateAction(unitId: string): Promise<{
  success: boolean
  data: UnitCurriculumState | null
  error: string | null
}> {
  await requireRole("teacher")
  try {
    const { rows: unitRows } = await query<{ curriculum_id: string | null }>(
      `select curriculum_id from units where unit_id = $1 limit 1`,
      [unitId],
    )
    if (!unitRows[0]) return { success: false, data: null, error: "Unit not found." }
    const { rows: touchRows } = await query<{ touches: boolean }>(UNIT_TOUCHES_CURRICULUM_SQL, [unitId])
    return {
      success: true,
      data: { curriculumId: unitRows[0].curriculum_id, locked: Boolean(touchRows[0]?.touches) },
      error: null,
    }
  } catch (err) {
    console.error("[unit-curriculum] read state failed", err)
    return { success: false, data: null, error: "Failed to load unit curriculum." }
  }
}

/**
 * Set (or clear) a unit's curriculum. Allowed only while the unit is not locked
 * — i.e. no curriculum items are assigned yet. Setting to the current value is a
 * no-op success. Once locked, an admin must remediate via /admin/unit-curricula.
 */
export async function setUnitCurriculumAction(input: {
  unitId: string
  curriculumId: string | null
}): Promise<{ success: boolean; error: string | null }> {
  await requireRole("teacher")
  const { unitId, curriculumId } = input
  if (!unitId) return { success: false, error: "Missing unit." }

  try {
    const { rows: unitRows } = await query<{ curriculum_id: string | null; subject: string | null }>(
      `select curriculum_id, subject from units where unit_id = $1 limit 1`,
      [unitId],
    )
    if (!unitRows[0]) return { success: false, error: "Unit not found." }
    if ((unitRows[0].curriculum_id ?? null) === (curriculumId ?? null)) {
      return { success: true, error: null } // no change
    }

    const { rows: touchRows } = await query<{ touches: boolean }>(UNIT_TOUCHES_CURRICULUM_SQL, [unitId])
    if (touchRows[0]?.touches) {
      return {
        success: false,
        error: "This unit already has assigned objectives, so its curriculum is locked. Change it via Admin → Unit Curricula.",
      }
    }

    if (curriculumId) {
      // Curriculum must belong to the unit's subject.
      const { rows: cRows } = await query<{ subject: string | null }>(
        `select subject from curricula where curriculum_id = $1 limit 1`,
        [curriculumId],
      )
      if (!cRows[0]) return { success: false, error: "Curriculum not found." }
      if ((cRows[0].subject ?? null) !== (unitRows[0].subject ?? null)) {
        return { success: false, error: "That curriculum belongs to a different subject." }
      }
    }

    await query(`update units set curriculum_id = $2 where unit_id = $1`, [unitId, curriculumId])
    revalidatePath(`/units/${unitId}`)
    return { success: true, error: null }
  } catch (err) {
    console.error("[unit-curriculum] set failed", err)
    return { success: false, error: "Failed to set curriculum." }
  }
}
