import { readAllSubjectsAction, readMarkingGuidancesAction } from '@/lib/server-updates'
import { MarkingGuidanceManager } from '@/components/admin/MarkingGuidanceManager'

export default async function MarkingGuidancePage() {
  const [{ data: subjects }, { data: guidances }] = await Promise.all([
    readAllSubjectsAction(),
    readMarkingGuidancesAction(),
  ])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Marking Guidance</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Define reusable marking guidance templates per subject. Teachers can select one when configuring an Upload
          Exam Question activity.
        </p>
      </div>
      <MarkingGuidanceManager subjects={subjects ?? []} initialGuidances={guidances ?? []} />
    </div>
  )
}
