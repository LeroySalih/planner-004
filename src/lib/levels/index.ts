// The level a score earns, for a year group whose range an admin sets at
// /admin/levels (table year_group_levels, migration 121). Pure, so the same
// rule runs on the server and in the browser.
//
// A range of min..max covers the sub-levels min L, min M, min H, ... max H,
// evenly spaced over 0-100%. Year 7 at 1..3 has nine bands of 11.1%: 1L from
// 0%, 1M from 11.1%, ... 3H from 88.9%.

export type YearGroupLevels = {
  yearGroup: number
  minLevel: number
  maxLevel: number
}

export type LevelBoundary = {
  level: string
  minPercent: number
}

/** Used only when the table cannot be read (e.g. migration 121 not applied). */
export const DEFAULT_YEAR_GROUP_LEVELS: YearGroupLevels[] = [
  { yearGroup: 7, minLevel: 1, maxLevel: 3 },
  { yearGroup: 8, minLevel: 2, maxLevel: 4 },
  { yearGroup: 9, minLevel: 3, maxLevel: 5 },
  { yearGroup: 10, minLevel: 1, maxLevel: 7 },
  { yearGroup: 11, minLevel: 1, maxLevel: 9 },
]

export const MIN_LEVEL = 1
export const MAX_LEVEL = 9
const SUB_LEVELS = ["L", "M", "H"] as const

export function getLevelBoundaries(range: YearGroupLevels | null | undefined): LevelBoundary[] {
  if (!range || range.minLevel > range.maxLevel) return []
  const labels: string[] = []
  for (let level = range.minLevel; level <= range.maxLevel; level += 1) {
    for (const sub of SUB_LEVELS) labels.push(`${level}${sub}`)
  }
  return labels.map((level, index) => ({ level, minPercent: (index * 100) / labels.length }))
}

export function rangeForYear(ranges: YearGroupLevels[], year: number | null | undefined): YearGroupLevels | null {
  if (typeof year !== "number" || !Number.isFinite(year)) return null
  return ranges.find((range) => range.yearGroup === Math.round(year)) ?? null
}

/**
 * The level for a score in a year group, or null when the year group has no
 * range or there is no score. `rawScore` is a percentage (0-100) or a
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
