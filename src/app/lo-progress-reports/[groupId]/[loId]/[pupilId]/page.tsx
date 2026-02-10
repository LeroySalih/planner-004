import { getPupilLOSuccessCriteriaAction } from "../../../actions"
import { PupilSCList } from "./pupil-sc-list"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

type PageProps = {
  params: Promise<{ groupId: string; loId: string; pupilId: string }>
}

export default async function PupilLOSuccessCriteriaPage({ params }: PageProps) {
  const { groupId, loId, pupilId } = await params
  const result = await getPupilLOSuccessCriteriaAction(groupId, loId, pupilId)

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "LO Progress Reports", href: "/lo-progress-reports" },
        { label: result.groupId, href: `/lo-progress-reports/${encodeURIComponent(groupId)}` },
        { label: result.loTitle },
        { label: result.pupilName },
      ]}
      title={`${result.pupilName} - ${result.loTitle}`}
      subtitle={`${result.groupId} - ${result.groupSubject}`}
    >
      <div className="mb-4 text-xs text-muted-foreground">{result.aoTitle}</div>
      <PupilSCList successCriteria={result.successCriteria} />
    </TeacherPageLayout>
  )
}
