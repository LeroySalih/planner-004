/**
 * The year group a class teaches, read from its id.
 *
 * Class ids are shaped "<academic year>-<year group><set>-<subject>", e.g.
 * "26-8D-DT" or "26-10-DT". The year group is stored on the class
 * (groups.year_group) and is what chooses the shared scheme of work it
 * follows; this only derives a sensible starting value when a class is
 * created, and matches the backfill in migration 102.
 *
 * Null for anything that does not fit the shape — HOME-SCHOOL, say — which
 * simply means the class follows no shared plan until someone sets its year.
 */
export function yearGroupFromGroupId(groupId: string): number | null {
  const match = /^[0-9]{2}-([0-9]{1,2})/.exec(groupId.trim())
  if (!match) return null
  const year = Number(match[1])
  return Number.isInteger(year) && year >= 1 && year <= 13 ? year : null
}
