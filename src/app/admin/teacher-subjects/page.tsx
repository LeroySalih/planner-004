import { readAllProfilesAction } from '@/lib/server-actions/profile'
import { readAllSubjectsAction, readAllTeacherSubjectsAction } from '@/lib/server-updates'
import { TeacherSubjectManager } from '@/components/admin/teacher-subject-manager'

export default async function TeacherSubjectsPage() {
  const [profilesResult, subjectsResult, assignmentsResult] = await Promise.all([
    readAllProfilesAction(),
    readAllSubjectsAction(),
    readAllTeacherSubjectsAction(),
  ])

  const teachers = (profilesResult.data ?? [])
    .filter((p) => p.roles.includes('teacher'))
    .map((p) => ({
      userId: p.userId,
      displayName: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || p.userId,
    }))

  const activeSubjects = (subjectsResult.data ?? [])
    .filter((s) => s.active)
    .map((s) => s.subject)

  const assignmentMap = new Map<string, string[]>()
  for (const row of assignmentsResult.data ?? []) {
    const existing = assignmentMap.get(row.userId) ?? []
    existing.push(row.subject)
    assignmentMap.set(row.userId, existing)
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Teacher Subjects</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Assign subjects to teachers. The teacher planner only shows units matching a teacher&apos;s assigned subjects.
        </p>
      </div>
      <TeacherSubjectManager
        teachers={teachers}
        subjects={activeSubjects}
        initialAssignments={assignmentMap}
      />
    </div>
  )
}
