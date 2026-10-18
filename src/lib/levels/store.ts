import "server-only"

import { query } from "@/lib/db"
import { DEFAULT_YEAR_GROUP_LEVELS, type YearGroupLevels } from "@/lib/levels"

/**
 * Every year group's level range, lowest year first. Falls back to the
 * defaults if the table cannot be read, so a report never loses its levels
 * because of it.
 */
export async function readYearGroupLevels(): Promise<YearGroupLevels[]> {
  try {
    const { rows } = await query<{ year_group: number; min_level: number; max_level: number }>(
      "select year_group, min_level, max_level from year_group_levels order by year_group",
    )
    return rows.map((row) => ({ yearGroup: row.year_group, minLevel: row.min_level, maxLevel: row.max_level }))
  } catch (error) {
    console.error("[levels] could not read year_group_levels; using the defaults", error)
    return DEFAULT_YEAR_GROUP_LEVELS
  }
}
