/**
 * Group promotion moves a group into the next school year. A group id is a
 * hyphen-separated string of the form `<school-year>-<year-group>-<rest…>`,
 * e.g. `25-7A-DT`. Promotion adds one to the school-year segment and to the
 * numeric part of the year-group segment, keeping everything else unchanged:
 *
 *   25-7A-DT  → 26-8A-DT
 *   25-10-MA  → 26-11-MA
 *
 * Returns `null` when the id does not match this shape so callers can surface a
 * clear error rather than producing a nonsensical id.
 */
export function computePromotedGroupId(groupId: string): string | null {
  const trimmed = groupId.trim()
  const parts = trimmed.split("-")
  if (parts.length < 2) return null

  const [schoolYear, yearGroup, ...rest] = parts

  // School year: all digits (e.g. "25" → "26"), preserving zero-padded width.
  if (!/^\d+$/.test(schoolYear)) return null
  const nextSchoolYear = incrementNumericString(schoolYear)

  // Year group: leading digits + optional suffix (e.g. "7A" → "8A", "10" → "11").
  const yearGroupMatch = yearGroup.match(/^(\d+)(.*)$/)
  if (!yearGroupMatch) return null
  const nextYearGroup =
    incrementNumericString(yearGroupMatch[1]) + yearGroupMatch[2]

  return [nextSchoolYear, nextYearGroup, ...rest].join("-")
}

/** Increment a numeric string by one, preserving its original digit width. */
function incrementNumericString(value: string): string {
  const next = String(Number(value) + 1)
  return next.padStart(value.length, "0")
}
