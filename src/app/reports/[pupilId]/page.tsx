import { redirect } from "next/navigation"

import { PupilReportView } from "./report-view"
import { requireAuthenticatedProfile } from "@/lib/auth"

export default async function PupilReportPage({
  params,
}: {
  params: Promise<{ pupilId: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const { pupilId } = await params
  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/reports/${encodeURIComponent(profile.userId)}`)
  }
  return PupilReportView({ pupilId })
}
