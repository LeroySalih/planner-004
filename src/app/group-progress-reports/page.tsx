import { getGroupProgressListAction } from "./actions"
import { GroupList } from "./group-list"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readYearGroupLevels } from "@/lib/levels/store"

export default async function GroupProgressReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ summative?: string }>
}) {
  const params = await searchParams
  const summativeOnly = params.summative === 'true'
  const [groups, levelRanges] = await Promise.all([
    getGroupProgressListAction(summativeOnly),
    readYearGroupLevels(),
  ])

  return (
    <TeacherPageLayout
      maxWidth="full"
      title="Group Progress Reports"
      subtitle="Each class's unit scores, overall average and level per pupil"
    >
      <GroupList groups={groups} summativeOnly={summativeOnly} levelRanges={levelRanges} />
    </TeacherPageLayout>
  )
}
