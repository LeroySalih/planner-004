import { getClassLOMatrixAction } from "../actions"
import { LOPupilMatrix } from "./lo-pupil-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

type PageProps = {
  params: Promise<{ groupId: string }>
}

export default async function ClassLOProgressPage({ params }: PageProps) {
  const { groupId } = await params
  const result = await getClassLOMatrixAction(groupId)

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "LO Progress Reports", href: "/lo-progress-reports" },
        { label: result.groupId },
      ]}
      title={`${result.groupId} - ${result.groupSubject}`}
      subtitle="Individual pupil progress by learning objectives"
    >
      <LOPupilMatrix groupId={result.groupId} data={result.data} />
    </TeacherPageLayout>
  )
}
