import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getClassLOMatrixAction } from "../actions"
import { LOPupilMatrix } from "./lo-pupil-matrix"
import { PageLayout } from "@/components/layouts/PageLayout"

type PageProps = {
  params: Promise<{ groupId: string }>
}

export default async function ClassLOProgressPage({ params }: PageProps) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const { groupId } = await params
  const result = await getClassLOMatrixAction(groupId)

  return (
    <PageLayout
      breadcrumbs={[
        { label: "LO Progress Reports", href: "/lo-progress-reports" },
        { label: result.groupId },
      ]}
      title={`${result.groupId} - ${result.groupSubject}`}
      subtitle="Individual pupil progress by learning objectives"
    >
      <LOPupilMatrix groupId={result.groupId} data={result.data} />
    </PageLayout>
  )
}
