import Link from 'next/link'
import { requireTeacherProfile } from '@/lib/auth'
import { readTeacherGroupsForSowAction, readHalfTermsAction } from '@/lib/server-updates'

function currentAcademicYear(): number {
  const now = new Date()
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

export default async function SowLandingPage() {
  await requireTeacherProfile()

  const year = currentAcademicYear()
  const [groupsResult, halfTermsResult] = await Promise.all([
    readTeacherGroupsForSowAction(),
    readHalfTermsAction(year),
  ])

  const groups = groupsResult.data ?? []
  const plannedCount = halfTermsResult.data?.length ?? 0

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-medium text-[var(--color-text-primary)] mb-6">
        Schemes of Work — {year}/{String(year + 1).slice(2)}
      </h1>

      {groups.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No classes found. Set up your timetable in the Weekly Planner first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.group_id}
              href={`/sow/${g.group_id}`}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-5 hover:bg-[var(--color-background-tertiary)] transition-colors"
            >
              <p className="font-medium text-[var(--color-text-primary)]">{g.group_id}</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">{g.subject}</p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
                {plannedCount}/6 half terms configured
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
