import { PupilReportView } from "../../report-view"

export default async function PupilGroupReportPage({
  params,
}: {
  params: Promise<{ pupilId: string; groupId: string }>
}) {
  const { pupilId, groupId } = await params
  return PupilReportView({ pupilId, groupIdFilter: groupId })
}
