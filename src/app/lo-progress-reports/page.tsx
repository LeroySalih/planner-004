import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getLOProgressMatrixAction } from "./actions"
import { LOProgressMatrix } from "./lo-progress-matrix"
import { PageLayout } from "@/components/layouts/PageLayout"

export default async function LOProgressReportsPage() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const data = await getLOProgressMatrixAction()

  return (
    <PageLayout
      title="Learning Objective Progress Reports"
      subtitle="Monitor class progress by learning objectives"
    >
      <LOProgressMatrix data={data} />
    </PageLayout>
  )
}
