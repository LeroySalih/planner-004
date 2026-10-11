import { redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { loadPupilPicker } from "@/lib/pupil-picker"
import { loadPupilUnitsDetail } from "@/lib/pupil-units-data"

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
  const picker = await loadPupilPicker(profile, pupilId, (await searchParams).group)

  // Keyed by pupil so switching pupils resets the selected subject and unit.
  return <PupilUnitsView key={pupilId} detail={detail} picker={picker} />
}
