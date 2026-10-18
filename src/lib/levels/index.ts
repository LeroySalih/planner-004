// The level a score earns, by the school's Grade Boundary Calculator. Each year
// group has a top level an admin sets at /admin/levels (table
// year_group_levels, migrations 121-122). Pure, so the same rule runs on the
// server and in the browser.
//
// The calculator numbers 0, 1L, 1M, 1H, 2L ... up to the top level as steps
// 0..N, and step i starts at i / (N + 1) of the marks, rounded to a whole
// percent. So the top level starts one step below 100%: Year 7, top 5M
// (N = 14), has 1M from 13%, 1H from 20%, ... 5M from 93%. The lowest level
// awarded is 1L: a score below 1L's boundary is 1L, never 0.

export type YearGroupLevels = {
  yearGroup: number
  /** The highest level the year group can be awarded, e.g. "5M". */
  topLevel: string
}

export type LevelBoundary = {
  level: string
  minPercent: number
}

/** Every level in order, 1L ... 9H; any of them can be a year group's top level. */
export const TOP_LEVELS: readonly string[] = Array.from({ length: 9 }, (_, i) =>
  ["L", "M", "H"].map((sub) => `${i + 1}${sub}`),
).flat()

/** Used only when the table cannot be read (e.g. migration 121 not applied). */
export const DEFAULT_YEAR_GROUP_LEVELS: YearGroupLevels[] = [
  { yearGroup: 7, topLevel: "5M" },
  { yearGroup: 8, topLevel: "6M" },
  { yearGroup: 9, topLevel: "7M" },
  { yearGroup: 10, topLevel: "8H" },
  { yearGroup: 11, topLevel: "9H" },
]

/** 1L first, from 0%; then each level from its whole-number boundary. */
export function getLevelBoundaries(range: YearGroupLevels | null | undefined): LevelBoundary[] {
  const top = range ? TOP_LEVELS.indexOf(range.topLevel) + 1 : 0
  if (top <= 0) return []
  return TOP_LEVELS.slice(0, top).map((level, index) => ({
    level,
    minPercent: index === 0 ? 0 : Math.round(((index + 1) * 100) / (top + 1)),
  }))
}

export function rangeForYear(ranges: YearGroupLevels[], year: number | null | undefined): YearGroupLevels | null {
  if (typeof year !== "number" || !Number.isFinite(year)) return null
  return ranges.find((range) => range.yearGroup === Math.round(year)) ?? null
}

/**
 * The level for a score in a year group, or null when the year group has no
 * top level or there is no score. `rawScore` is a percentage (0-100) or a
 * fraction (0-1).
 */
export function getLevelForYearScore(
  ranges: YearGroupLevels[],
  year: number | null | undefined,
  rawScore: number | null | undefined,
): string | null {
  if (rawScore === null || rawScore === undefined || Number.isNaN(rawScore)) return null
  const boundaries = getLevelBoundaries(rangeForYear(ranges, year))
  if (boundaries.length === 0) return null

  const clamped = Math.max(0, rawScore)
  const percent = clamped > 1 ? clamped : clamped * 100
  let resolved = boundaries[0].level
  for (const entry of boundaries) {
    if (percent >= entry.minPercent) resolved = entry.level
    else break
  }
  return resolved
}

/** The year group in a class id such as "25-7A-IT" (year 7), or null. */
export function yearGroupFromGroupId(groupId: string): number | null {
  const match = groupId.match(/^\d+-(\d+)[A-Z]?-/)
  return match?.[1] ? parseInt(match[1], 10) : null
}
