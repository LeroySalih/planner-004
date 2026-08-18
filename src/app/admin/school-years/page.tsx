import { readSchoolYearsAction } from '@/lib/server-updates'
import { SchoolYearManager } from '@/components/admin/SchoolYearManager'

export default async function SchoolYearsPage() {
  const { data } = await readSchoolYearsAction()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">School Years</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Add, edit, or deactivate school years. Only active years appear in year selectors. The
          year marked <strong>current</strong> is the default used across the app — Schemes of
          Work, half terms, and anywhere a year is not chosen explicitly.
        </p>
      </div>
      <SchoolYearManager initialYears={data ?? []} />
    </div>
  )
}
