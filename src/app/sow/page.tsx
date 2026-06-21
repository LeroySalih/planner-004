import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { readTeacherGroupsForSowAction, readTeachersAction } from '@/lib/server-updates'
import { currentAcademicYear, academicYearLabel } from '@/lib/academic-year'
import { SowLandingClient } from '@/components/sow/SowLandingClient'

export default async function SowLandingPage() {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')

  const year = currentAcademicYear()
  const [groupsResult, teachersResult] = await Promise.all([
    readTeacherGroupsForSowAction(),
    isAdmin ? readTeachersAction() : Promise.resolve({ data: [], error: null }),
  ])

  const groups = groupsResult.data ?? []

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-medium text-[var(--color-text-primary)] mb-6">
        Schemes of Work — {academicYearLabel(year)}
      </h1>
      <SowLandingClient
        initialGroups={groups}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
      />
    </main>
  )
}
