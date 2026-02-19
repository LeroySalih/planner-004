import { getPupilUnitLOSCAction } from "../../../actions"
import { PupilLOSCList } from "./pupil-lo-sc-list"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string; pupilId: string }>
}

export default async function PupilUnitLessonsPage({ params }: PageProps) {
  const { groupId, unitId, pupilId } = await params
  const result = await getPupilUnitLOSCAction(groupId, unitId, pupilId)

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "Unit Progress Reports", href: "/unit-progress-reports" },
        { label: result.groupId, href: `/unit-progress-reports/${encodeURIComponent(groupId)}` },
        { label: result.unitTitle, href: `/unit-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(unitId)}` },
        { label: result.pupilName },
      ]}
      title={`${result.pupilName} - ${result.unitTitle}`}
      subtitle={`${result.groupId} - ${result.groupSubject}`}
    >
      <PupilLOSCList data={result.data} />
    </TeacherPageLayout>
  )
}
