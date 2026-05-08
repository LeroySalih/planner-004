import { readGroupsAction, readUnitsAction } from '@/lib/server-updates'
import { requireTeacherProfile } from '@/lib/auth'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage() {
  await requireTeacherProfile()

  const [groupsResult, unitsResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[95%] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <div className="max-w-[95%] mx-auto mb-6">
        <h1 className="text-xl font-medium text-[var(--color-text-primary)] m-0">
          Weekly planner
        </h1>
      </div>
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
      />
    </main>
  )
}
