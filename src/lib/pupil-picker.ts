import { hasRole, type AuthenticatedProfile } from '@/lib/auth'
import { listGroupPupils } from '@/lib/assessments/store'
import { query } from '@/lib/db'
import { listGroups } from '@/lib/mcp/timetable'

/**
 * Data for the admin-only "View as pupil" picker on My Units, My Assessments
 * and My Interventions: every active class, and the pupils of the chosen one.
 * Null for anyone who is not an admin.
 */
export type PupilPickerData = {
  groups: Array<{ groupId: string; subject: string | null }>
  groupId: string | null
  pupils: Array<{ pupilId: string; name: string }>
  pupilId: string
}

export async function loadPupilPicker(
  profile: AuthenticatedProfile,
  pupilId: string,
  requestedGroupId: string | undefined,
): Promise<PupilPickerData | null> {
  if (!hasRole(profile, 'admin')) return null

  const groups = await listGroups()
  // Without a chosen class, start from one the viewed pupil belongs to.
  const groupId = requestedGroupId && groups.some((g) => g.group_id === requestedGroupId)
    ? requestedGroupId
    : (
      await query<{ group_id: string }>(
        `select gm.group_id from group_membership gm
           join groups g on g.group_id = gm.group_id and g.active is not false
          where gm.user_id = $1
          order by gm.group_id desc
          limit 1`,
        [pupilId],
      )
    ).rows[0]?.group_id ?? null
  const pupils = groupId ? await listGroupPupils(groupId) : []

  return {
    groups: groups.map((g) => ({ groupId: g.group_id, subject: g.subject })),
    groupId,
    pupils: pupils.map((p) => ({
      pupilId: p.pupil_id,
      name: [p.last_name, p.first_name].filter(Boolean).join(', ') || p.pupil_id,
    })),
    pupilId,
  }
}

/**
 * Whose page this is: the signed-in user, or — for an admin only — the pupil
 * named in ?pupil=. Anyone else asking for another pupil gets their own page.
 */
export function viewedPupilId(profile: AuthenticatedProfile, requestedPupilId: string | undefined): string {
  return requestedPupilId && hasRole(profile, 'admin') ? requestedPupilId : profile.userId
}
