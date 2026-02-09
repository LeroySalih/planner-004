import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getPupilUnitLessonsAction } from "../../../actions"
import { PupilLessonList } from "./pupil-lesson-list"
import { PageLayout } from "@/components/layouts/PageLayout"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string; pupilId: string }>
}

export default async function PupilUnitLessonsPage({ params }: PageProps) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const { groupId, unitId, pupilId } = await params
  const result = await getPupilUnitLessonsAction(groupId, unitId, pupilId)

  return (
    <PageLayout
      breadcrumbs={[
        { label: "Unit Progress Reports", href: "/unit-progress-reports" },
        { label: result.groupId, href: `/unit-progress-reports/${encodeURIComponent(groupId)}` },
        { label: result.unitTitle },
        { label: result.pupilName },
      ]}
      title={`${result.pupilName} - ${result.unitTitle}`}
      subtitle={`${result.groupId} - ${result.groupSubject}`}
    >
      <PupilLessonList lessons={result.lessons} />
    </PageLayout>
  )
}
