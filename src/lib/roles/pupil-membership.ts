/**
 * Who counts as a pupil in a class.
 *
 * Teachers routinely also carry a pupil role, so they can see a lesson as a
 * pupil does. group_membership does not record why someone is in a group, so
 * "is a member" and "is a pupil" are different questions and a roster that
 * conflates them puts staff among the children — in the lists, in every
 * average, and in the per-pupil file lookups.
 *
 * Use this only for rosters and class statistics. Access checks ("may this
 * person open the group?") and the membership editor must keep seeing staff,
 * or teachers lose access to their own classes.
 */
export const STAFF_ROLE_IDS = ["teacher", "admin", "technician"] as const;

/** True when the roles held by one person make them a pupil of the class. */
export function isPupilRoleSet(roles: Iterable<string>): boolean {
  const held = new Set<string>();
  for (const role of roles) held.add(role.trim().toLowerCase());
  return held.has("pupil") &&
    !STAFF_ROLE_IDS.some((staffRole) => held.has(staffRole));
}

/**
 * Collapse `(user_id, role_id)` rows — one per role — into the pupils among
 * them. Filtering the rows directly is the mistake this exists to prevent: a
 * teacher who also holds "pupil" has a row that passes.
 */
export function pupilIdsFromRoleRows(
  rows: Iterable<{ user_id: string | null; role: string | null }>,
): string[] {
  const rolesByUser = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const roles = rolesByUser.get(row.user_id) ?? new Set<string>();
    if (row.role) roles.add(row.role);
    rolesByUser.set(row.user_id, roles);
  }
  return Array.from(rolesByUser.entries())
    .filter(([, roles]) => isPupilRoleSet(roles))
    .map(([userId]) => userId);
}

/**
 * SQL restricting a group_membership row to a pupil of the class.
 *
 * `alias` names the group_membership alias in the surrounding query and is
 * always a literal written here, never anything a user supplies.
 */
export function pupilMembershipSql(alias = "gm"): string {
  const staffList = STAFF_ROLE_IDS.map((role) => `'${role}'`).join(", ");
  return `exists (
      select 1 from user_roles ur
       where ur.user_id = ${alias}.user_id and lower(ur.role_id) = 'pupil'
    )
    and not exists (
      select 1 from user_roles ur
       where ur.user_id = ${alias}.user_id and lower(ur.role_id) in (${staffList})
    )`;
}

/**
 * The pupil user ids, resolved in one query.
 *
 * pupilMembershipSql() is fine for a simple roster lookup, but inside a large
 * aggregate join it is catastrophic: measured at 1010ms per class against 29ms
 * with no filter at all. Both the correlated EXISTS form and a set-based
 * IN/EXCEPT behave the same way — adding any predicate on the joined user id
 * flips the planner onto a far worse join order.
 *
 * Resolving the set once and passing it as an array parameter keeps the same
 * rule and costs 45ms per class. Use this for reports and matrices; use the SQL
 * fragment for one-off roster reads where the result set is small.
 */
export async function resolvePupilIds(
  run: (sql: string) => Promise<{ rows: Array<{ user_id: string }> }>,
): Promise<string[]> {
  const staffList = STAFF_ROLE_IDS.map((role) => `'${role}'`).join(", ");
  const { rows } = await run(
    `SELECT ur.user_id FROM user_roles ur WHERE lower(ur.role_id) = 'pupil'
     EXCEPT
     SELECT ur.user_id FROM user_roles ur WHERE lower(ur.role_id) IN (${staffList})`,
  );
  return rows.map((row) => row.user_id);
}
