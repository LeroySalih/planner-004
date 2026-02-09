import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getUnitLessonMatrixAction } from "../../actions"
import { LessonMatrix } from "./lesson-matrix"
import { PageLayout } from "@/components/layouts/PageLayout"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string }>
}

export default async function UnitLessonProgressPage({ params }: PageProps) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const { groupId, unitId } = await params
  const result = await getUnitLessonMatrixAction(groupId, unitId)

  return (
    <PageLayout
      breadcrumbs={[
        { label: "Unit Progress Reports", href: "/unit-progress-reports" },
        { label: result.groupId, href: `/unit-progress-reports/${encodeURIComponent(groupId)}` },
        { label: result.unitTitle },
      ]}
      title={result.unitTitle}
      subtitle={`${result.groupId} - ${result.groupSubject} · Lesson-level progress`}
    >
      <LessonMatrix data={result.data} />
    </PageLayout>
  )
}
