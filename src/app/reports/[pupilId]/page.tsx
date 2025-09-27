import { PupilReportView } from "./report-view"

export default async function PupilReportPage({
  params,
}: {
  params: Promise<{ pupilId: string }>
}) {
  const { pupilId } = await params
  return PupilReportView({ pupilId })
}
