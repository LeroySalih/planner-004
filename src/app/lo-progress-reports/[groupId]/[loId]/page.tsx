import { getClassLOSCMatrixAction } from "../../actions"
import { LOSCPupilMatrix } from "./lo-sc-pupil-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

type PageProps = {
  params: Promise<{ groupId: string; loId: string }>
}

export default async function ClassLOSCProgressPage({ params }: PageProps) {
  const { groupId, loId } = await params
  const result = await getClassLOSCMatrixAction(groupId, loId)

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "LO Progress Reports", href: "/lo-progress-reports" },
        { label: result.groupId, href: `/lo-progress-reports/${encodeURIComponent(groupId)}` },
        { label: result.loTitle },
      ]}
      title={`${result.groupId} - ${result.loTitle}`}
      subtitle={`${result.groupSubject} — ${result.aoTitle}`}
    >
      <LOSCPupilMatrix groupId={result.groupId} loId={result.loId} data={result.data} />
    </TeacherPageLayout>
  )
}
