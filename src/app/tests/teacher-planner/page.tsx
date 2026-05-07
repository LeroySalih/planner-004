import { readGroupsAction, readUnitsAction } from '@/lib/server-updates'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage() {
  const [groupsResult, unitsResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[760px] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data. Make sure you are signed in as a teacher.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <div className="max-w-[760px] mx-auto mb-6">
        <h1 className="text-xl font-medium text-[var(--color-text-primary)] m-0">
          Weekly planner
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1 m-0">
          Prototype — state resets on refresh
        </p>
      </div>
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
      />
    </main>
  )
}
