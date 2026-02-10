import { getLOProgressMatrixAction } from "./actions"
import { LOProgressMatrix } from "./lo-progress-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

export default async function LOProgressReportsPage() {
  const data = await getLOProgressMatrixAction()

  return (
    <TeacherPageLayout
      title="Learning Objective Progress Reports"
      subtitle="Monitor class progress by learning objectives"
    >
      <LOProgressMatrix data={data} />
    </TeacherPageLayout>
  )
}
