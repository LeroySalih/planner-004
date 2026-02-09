import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { getProgressMatrixAction } from "./actions"
import { ProgressMatrix } from "./progress-matrix"
import { PageLayout } from "@/components/layouts/PageLayout"

export default async function ProgressReportsPage() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  const data = await getProgressMatrixAction()

  return (
    <PageLayout
      title="Unit Progress Reports"
      subtitle="Monitor class progress by units"
    >
      <ProgressMatrix data={data} />
    </PageLayout>
  )
}
