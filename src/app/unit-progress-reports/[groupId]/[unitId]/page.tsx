import { getUnitLessonMatrixAction } from "../../actions"
import { LessonMatrix } from "./lesson-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readYearGroupLevels } from "@/lib/levels/store"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string }>
  searchParams: Promise<{ summative?: string }>
}

export default async function UnitLessonProgressPage({ params, searchParams }: PageProps) {
  const { groupId, unitId: rawUnitId } = await params
  const unitId = decodeURIComponent(rawUnitId)
  const sp = await searchParams
  const summativeOnly = sp.summative === 'true'
  const [result, levelRanges] = await Promise.all([
    getUnitLessonMatrixAction(groupId, unitId, summativeOnly),
    readYearGroupLevels(),
  ])

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
      <LessonMatrix data={result.data} summativeOnly={summativeOnly} groupId={result.groupId} unitId={result.unitId} levelRanges={levelRanges} />
    </TeacherPageLayout>
  )
}
