"use server"

import { requireRole } from "@/lib/auth"
import { query, withDbClient } from "@/lib/db"
import { removeCurriculumFromUnit, UNIT_ITEMS_CTE } from "@/lib/curriculum/unit-curriculum-guard"
import { revalidatePath } from "next/cache"

export interface UnitCurriculumBreakdownEntry {
  curriculumId: string
  curriculumTitle: string
  loCount: number
  scCount: number
}

export interface MultiCurriculumUnit {
  unitId: string
  unitTitle: string
  currentCurriculumId: string | null
  curricula: UnitCurriculumBreakdownEntry[]
}

/** Units touching more than one curriculum, with a per-curriculum breakdown. */
export async function readMultiCurriculumUnitsAction(): Promise<{
  success: boolean
  data: MultiCurriculumUnit[]
  error: string | null
}> {
  await requireRole("admin")
  try {
    const { rows } = await query<{
      unit_id: string
      unit_title: string | null
      current_curriculum_id: string | null
      curriculum_id: string
      curriculum_title: string | null
      lo_count: string
      sc_count: string
    }>(
      `${UNIT_ITEMS_CTE}
       select ui.unit_id,
              u.title as unit_title,
              u.curriculum_id as current_curriculum_id,
              ui.curriculum_id,
              c.title as curriculum_title,
              count(distinct ui.lo_id) as lo_count,
              count(distinct ui.sc_id) as sc_count
       from unit_items ui
       join per_unit pu on pu.unit_id = ui.unit_id and pu.curr_count > 1
       join units u on u.unit_id = ui.unit_id
       join curricula c on c.curriculum_id = ui.curriculum_id
       group by ui.unit_id, u.title, u.curriculum_id, ui.curriculum_id, c.title
       order by u.title asc, c.title asc`,
    )

    const byUnit = new Map<string, MultiCurriculumUnit>()
    for (const r of rows) {
      if (!byUnit.has(r.unit_id)) {
        byUnit.set(r.unit_id, {
          unitId: r.unit_id,
          unitTitle: r.unit_title ?? r.unit_id,
          currentCurriculumId: r.current_curriculum_id,
          curricula: [],
        })
      }
      byUnit.get(r.unit_id)!.curricula.push({
        curriculumId: r.curriculum_id,
        curriculumTitle: r.curriculum_title ?? r.curriculum_id,
        loCount: Number(r.lo_count),
        scCount: Number(r.sc_count),
      })
    }
    return { success: true, data: Array.from(byUnit.values()), error: null }
  } catch (err) {
    console.error("[unit-curricula-admin] read failed", err)
    return { success: false, data: [], error: "Failed to load multi-curriculum units." }
  }
}

/**
 * Keep one curriculum for a unit: remove every OTHER curriculum's LOs/SCs from
 * the unit (including from its lessons and activities), then lock the unit to
 * the kept curriculum. Transactional.
 */
export async function keepUnitCurriculumAction(input: {
  unitId: string
  keepCurriculumId: string
}): Promise<{ success: boolean; removedLinks: number; error: string | null }> {
  await requireRole("admin")
  const { unitId, keepCurriculumId } = input
  if (!unitId || !keepCurriculumId) return { success: false, removedLinks: 0, error: "Missing parameters." }

  try {
    let removedLinks = 0
    await withDbClient(async (client) => {
      await client.query("begin")
      try {
        // Which other curricula does this unit currently touch?
        const { rows: otherRows } = await client.query<{ curriculum_id: string }>(
          `${UNIT_ITEMS_CTE}
           select distinct ui.curriculum_id
           from unit_items ui
           where ui.unit_id = $1 and ui.curriculum_id <> $2`,
          [unitId, keepCurriculumId],
        )
        for (const { curriculum_id } of otherRows) {
          removedLinks += await removeCurriculumFromUnit(client, unitId, curriculum_id)
        }
        await client.query(`update units set curriculum_id = $2 where unit_id = $1`, [unitId, keepCurriculumId])
        await client.query("commit")
      } catch (err) {
        await client.query("rollback")
        throw err
      }
    })
    revalidatePath("/admin/unit-curricula")
    revalidatePath(`/units/${unitId}`)
    return { success: true, removedLinks, error: null }
  } catch (err) {
    console.error("[unit-curricula-admin] keep failed", err)
    const message = err instanceof Error ? err.message : "Failed to apply."
    return { success: false, removedLinks: 0, error: message }
  }
}
