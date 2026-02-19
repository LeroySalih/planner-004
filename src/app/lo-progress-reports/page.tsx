import { getLOProgressMatrixAction } from "./actions"
import { LOProgressMatrix } from "./lo-progress-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"

export default async function LOProgressReportsPage() {
  const data = await getLOProgressMatrixAction()

  return (
    <TeacherPageLayout
      title="Learning Objective Progress Reports"
      subtitle="Use this report to identify where we can make whole class improvements to the unit"
    >
      <LOProgressMatrix data={data} />
    </TeacherPageLayout>
  )
}
