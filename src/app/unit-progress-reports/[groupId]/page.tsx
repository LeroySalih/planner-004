import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getClassPupilMatrixAction } from "../actions"
import { PupilMatrix } from "./pupil-matrix"
import { PageLayout } from "@/components/layouts/PageLayout"

type PageProps = {
  params: Promise<{ groupId: string }>
}

export default async function ClassProgressPage({ params }: PageProps) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const { groupId } = await params
  const result = await getClassPupilMatrixAction(groupId)

  return (
    <PageLayout
      breadcrumbs={[
        { label: "Unit Progress Reports", href: "/unit-progress-reports" },
        { label: result.groupId },
      ]}
      title={`${result.groupId} - ${result.groupSubject}`}
      subtitle="Individual pupil progress for this class"
    >
      <PupilMatrix groupId={result.groupId} data={result.data} />
    </PageLayout>
  )
}
