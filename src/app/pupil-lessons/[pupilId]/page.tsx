import { redirect } from "next/navigation"

import { hasRole, requireAuthenticatedProfile } from "@/lib/auth"
import { listGroupPupils } from "@/lib/assessments/store"
import { query } from "@/lib/db"
import { listGroups } from "@/lib/mcp/timetable"
import { loadPupilUnitsDetail } from "@/lib/pupil-units-data"

import type { PupilPickerProps } from "./pupil-picker"
import { PupilUnitsView } from "./pupil-units-view"

export default async function PupilLessonsDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ pupilId: string }>
  searchParams: Promise<{ group?: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const { pupilId } = await params

  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/pupil-lessons/${encodeURIComponent(profile.userId)}`)
  }

  const detail = await loadPupilUnitsDetail(pupilId)

  // Admins can switch to any pupil's view of this page.
  let picker: PupilPickerProps | null = null
  if (hasRole(profile, "admin")) {
    const groups = await listGroups()
    const requested = (await searchParams).group
    // Without a chosen class, start from one the viewed pupil belongs to.
    const groupId = requested && groups.some((g) => g.group_id === requested)
      ? requested
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
    picker = {
      groups: groups.map((g) => ({ groupId: g.group_id, subject: g.subject })),
      groupId,
      pupils: pupils.map((p) => ({
        pupilId: p.pupil_id,
        name: [p.last_name, p.first_name].filter(Boolean).join(", ") || p.pupil_id,
      })),
      pupilId,
    }
  }

  // Keyed by pupil so switching pupils resets the selected subject and unit.
  return <PupilUnitsView key={pupilId} detail={detail} picker={picker} />
}
