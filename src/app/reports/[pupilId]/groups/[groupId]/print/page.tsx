import type { Metadata } from "next"

import { PupilReportView } from "../../../report-view"

export const metadata: Metadata = {
  title: "Printable pupil report",
}

export default async function PupilGroupReportPrintPage({
  params,
}: {
  params: Promise<{ pupilId: string; groupId: string }>
}) {
  const { pupilId, groupId } = await params
  return PupilReportView({ pupilId, groupIdFilter: groupId, variant: "print" })
}
