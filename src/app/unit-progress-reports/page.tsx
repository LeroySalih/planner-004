import { getProgressMatrixAction } from "./actions"
import { ProgressMatrix } from "./progress-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

export default async function ProgressReportsPage({
  searchParams
}: {
  searchParams: { summative?: string }
}) {
  const summativeOnly = searchParams.summative === 'true'
  const data = await getProgressMatrixAction(summativeOnly)

  return (
    <TeacherPageLayout
      title="Unit Progress Reports"
      subtitle="Monitor class progress by units"
    >
      <ProgressMatrix data={data} summativeOnly={summativeOnly} />
    </TeacherPageLayout>
  )
}
