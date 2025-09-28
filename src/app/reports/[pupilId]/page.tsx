import { PupilReportView } from "./report-view"
import { requireTeacherProfile } from "@/lib/auth"

export default async function PupilReportPage({
  params,
}: {
  params: Promise<{ pupilId: string }>
}) {
  await requireTeacherProfile()
  const { pupilId } = await params
  return PupilReportView({ pupilId })
}
