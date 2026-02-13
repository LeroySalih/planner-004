import { getClassPupilMatrixAction } from "../actions"
import { PupilMatrix } from "./pupil-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

type PageProps = {
  params: Promise<{ groupId: string }>
  searchParams: { summative?: string }
}

export default async function ClassProgressPage({ params, searchParams }: PageProps) {
  const { groupId } = await params
  const summativeOnly = searchParams.summative === 'true'
  const result = await getClassPupilMatrixAction(groupId, summativeOnly)

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "Unit Progress Reports", href: "/unit-progress-reports" },
        { label: result.groupId },
      ]}
      title={`${result.groupId} - ${result.groupSubject}`}
      subtitle="Individual pupil progress for this class"
    >
      <PupilMatrix groupId={result.groupId} data={result.data} summativeOnly={summativeOnly} />
    </TeacherPageLayout>
  )
}
