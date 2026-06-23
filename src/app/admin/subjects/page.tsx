import { readAllSubjectsAction } from '@/lib/server-updates'
import { SubjectManager } from '@/components/admin/SubjectManager'

export default async function SubjectsPage() {
  const { data } = await readAllSubjectsAction()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Subjects</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Add subjects or deactivate ones no longer in use. Only active subjects appear in subject pickers across the app.
        </p>
      </div>
      <SubjectManager initialSubjects={data ?? []} />
    </div>
  )
}
