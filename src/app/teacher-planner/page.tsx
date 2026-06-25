import { readGroupsAction, readUnitsAction, readTeachersAction, readTeacherSubjectsAction } from '@/lib/server-updates'
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

  const [groupsResult, unitsResult, teachersResult, teacherSubjectsResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
    readTeachersAction(),
    readTeacherSubjectsAction({ currentProfile: profile }),
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

  const allUnits = unitsResult.data ?? []
  const allGroups = groupsResult.data ?? []
  const teacherSubjects = teacherSubjectsResult.data ?? []
  const visibleUnits = isAdmin
    ? allUnits
    : allUnits.filter((unit) => teacherSubjects.includes(unit.subject))
  const visibleGroups = isAdmin
    ? allGroups
    : allGroups.filter((group) => teacherSubjects.includes(group.subject))

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <TeacherPlannerClient
        units={visibleUnits}
        groups={visibleGroups}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
        initialWeek={week}
        initialSelectedTeacherId={teacherId}
      />
    </main>
  )
}
