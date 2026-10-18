import { getGroupProgressAction } from "../actions"
import { GroupMatrix } from "./group-matrix"
import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readYearGroupLevels } from "@/lib/levels/store"

type PageProps = {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{ summative?: string }>
}

export default async function GroupProgressPage({ params, searchParams }: PageProps) {
  const { groupId: rawGroupId } = await params
  const groupId = decodeURIComponent(rawGroupId)
  const sp = await searchParams
  const summativeOnly = sp.summative === 'true'
  const [result, levelRanges] = await Promise.all([
    getGroupProgressAction(groupId, summativeOnly),
    readYearGroupLevels(),
  ])

  return (
    <TeacherPageLayout
      maxWidth="full"
      breadcrumbs={[
        { label: "Group Progress Reports", href: "/group-progress-reports" },
        { label: result.groupId },
      ]}
      title={`${result.groupId} - ${result.groupSubject}`}
      subtitle="Unit scores, overall average and level for each pupil"
    >
      <GroupMatrix
        groupId={result.groupId}
        units={result.units}
        cells={result.cells}
        assessments={result.assessments}
        assessmentResults={result.assessmentResults}
        summativeOnly={summativeOnly}
        levelRanges={levelRanges}
      />
    </TeacherPageLayout>
  )
}
