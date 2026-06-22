import { readGroupsAction, readUnitsAction, readTeachersAction } from '@/lib/server-updates'
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; teacherId?: string }>
}) {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')
  const { week, teacherId } = await searchParams

  const [groupsResult, unitsResult, teachersResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
    readTeachersAction(),
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
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
        initialWeek={week}
        initialSelectedTeacherId={teacherId}
      />
    </main>
  )
}
