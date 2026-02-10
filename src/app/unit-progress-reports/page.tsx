import { getProgressMatrixAction } from "./actions"
import { ProgressMatrix } from "./progress-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

export default async function ProgressReportsPage() {
  const data = await getProgressMatrixAction()

  return (
    <TeacherPageLayout
      title="Unit Progress Reports"
      subtitle="Monitor class progress by units"
    >
      <ProgressMatrix data={data} />
    </TeacherPageLayout>
  )
}
