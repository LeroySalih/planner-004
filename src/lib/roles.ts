/**
 * The roles a person has. The single rule for both a DINO session
 * (readProfile in src/lib/auth.ts) and the `roles` claim of an OAuth access
 * token, so the two can never disagree:
 *   - every user_roles row counts;
 *   - the legacy profiles.is_teacher flag adds "teacher";
 *   - nobody is left with no role: no rows at all means "pupil".
 *
 * Pure, so it is safe in any runtime and testable without a database.
 * effectiveRolesSql below mirrors it for queries; change both together.
 */
export function effectiveRoles(roleRows: readonly string[], isTeacherFlag: boolean): string[] {
  const roles = [...new Set(roleRows.map((role) => role.toLowerCase()))]
  if (isTeacherFlag && !roles.includes("teacher")) roles.push("teacher")
  if (roles.length === 0) roles.push("pupil")
  return roles
}

/**
 * SQL boolean: the user in `userColumn` has at least one of the roles in the
 * text[] expression `rolesExpr`, by the rule of effectiveRoles.
 */
export function hasAnyEffectiveRoleSql(userColumn: string, rolesExpr: string): string {
  return `exists (
    select 1 from profiles p
    where p.user_id = ${userColumn}
      and (
        exists (select 1 from user_roles ur where ur.user_id = p.user_id and lower(ur.role_id) = any(${rolesExpr}))
        or (p.is_teacher is true and 'teacher' = any(${rolesExpr}))
        or (p.is_teacher is not true
            and not exists (select 1 from user_roles ur where ur.user_id = p.user_id)
            and 'pupil' = any(${rolesExpr}))
      )
  )`
}
