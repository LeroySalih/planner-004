import { readSchoolYearsAction } from '@/lib/server-updates'
import { SchoolYearManager } from '@/components/admin/SchoolYearManager'

export default async function SchoolYearsPage() {
  const { data } = await readSchoolYearsAction()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">School Years</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Add, edit, or deactivate school years. Only active years appear in year selectors across the app.
        </p>
      </div>
      <SchoolYearManager initialYears={data ?? []} />
    </div>
  )
}
