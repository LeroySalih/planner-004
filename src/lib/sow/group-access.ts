/**
 * Which groups a teacher sees on the scheme-of-work pages.
 *
 * Two routes in, unioned:
 *
 *  - a timetable slot, meaning they actually teach it at a fixed day/period;
 *  - membership of the group, which is what the "Add Teacher" button on the
 *    group page writes (group_membership, no role column — a teacher is told
 *    apart from a pupil by profiles.is_teacher).
 *
 * Only the first was consulted before, which hid 22 groups from Leroy alone:
 * he was already a member of every DT class missing from his list, the page
 * simply never asked. Membership is the better signal now that units can be
 * planned into a half-term before anything is timetabled — you plan for the
 * classes you teach, not for the slots you happen to hold.
 *
 * A plain module rather than living beside the actions that use it: a
 * 'use server' file may only export async functions, so a shared SQL fragment
 * cannot sit there. Shared rather than duplicated because the landing list and
 * the detail page's year-switcher guard have to agree — when they did not, a
 * group could be listed and then throw "Unauthorized" the moment you changed
 * year.
 *
 * Assumes the surrounding query aliases public.groups as `g` and passes the
 * teacher id as `$1`.
 */
export const SOW_GROUP_ACCESS_PREDICATE = `
  EXISTS (
    SELECT 1 FROM timetable_slot_groups tsg
     WHERE tsg.teacher_id = $1 AND tsg.group_id = g.group_id
  )
  OR EXISTS (
    SELECT 1 FROM group_membership gm
     WHERE gm.user_id = $1 AND gm.group_id = g.group_id
  )
`
