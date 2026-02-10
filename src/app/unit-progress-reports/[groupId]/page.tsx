import { getClassPupilMatrixAction } from "../actions"
import { PupilMatrix } from "./pupil-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

type PageProps = {
  params: Promise<{ groupId: string }>
}

export default async function ClassProgressPage({ params }: PageProps) {
  const { groupId } = await params
  const result = await getClassPupilMatrixAction(groupId)

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "Unit Progress Reports", href: "/unit-progress-reports" },
        { label: result.groupId },
      ]}
      title={`${result.groupId} - ${result.groupSubject}`}
      subtitle="Individual pupil progress for this class"
    >
      <PupilMatrix groupId={result.groupId} data={result.data} />
    </TeacherPageLayout>
  )
}
