import { getUnitLessonMatrixAction } from "../../actions"
import { LessonMatrix } from "./lesson-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string }>
}

export default async function UnitLessonProgressPage({ params }: PageProps) {
  const { groupId, unitId } = await params
  const result = await getUnitLessonMatrixAction(groupId, unitId)

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "Unit Progress Reports", href: "/unit-progress-reports" },
        { label: result.groupId, href: `/unit-progress-reports/${encodeURIComponent(groupId)}` },
        { label: result.unitTitle },
      ]}
      title={result.unitTitle}
      subtitle={`${result.groupId} - ${result.groupSubject} · Lesson-level progress`}
    >
      <LessonMatrix data={result.data} />
    </TeacherPageLayout>
  )
}
