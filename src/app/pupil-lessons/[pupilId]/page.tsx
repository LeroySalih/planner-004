import { redirect } from "next/navigation"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { loadPupilUnitsDetail } from "@/lib/pupil-units-data"

import { PupilUnitsView } from "./pupil-units-view"

export default async function PupilLessonsDetailPage({
  params,
}: {
  params: Promise<{ pupilId: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const { pupilId } = await params

  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/pupil-lessons/${encodeURIComponent(profile.userId)}`)
  }

  const detail = await loadPupilUnitsDetail(pupilId)

  return <PupilUnitsView detail={detail} />
}
