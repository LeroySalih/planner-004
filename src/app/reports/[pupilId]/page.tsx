import { performance } from "node:perf_hooks"
import { redirect } from "next/navigation"

import { PupilReportView } from "./report-view"
import { requireAuthenticatedProfile } from "@/lib/auth"

export const revalidate = 0

export default async function PupilReportPage({
  params,
}: {
  params: Promise<{ pupilId: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const authEnd = performance.now()
  const { pupilId } = await params
  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/reports/${encodeURIComponent(profile.userId)}`)
  }
  return PupilReportView({ pupilId, authEndTime: authEnd })
}
