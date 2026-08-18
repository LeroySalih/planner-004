import { requireRole } from '@/lib/auth'
import { readHalfTermsAction } from '@/lib/server-updates'
import { HalfTermManager } from '@/components/admin/HalfTermManager'
import { fetchActiveAcademicYears, resolveCurrentAcademicYear } from '@/lib/academic-year'

export default async function AdminHalfTermsPage() {
  await requireRole('admin')

  const year = await resolveCurrentAcademicYear()
  const [{ data: halfTerms }, activeYears] = await Promise.all([
    readHalfTermsAction(year),
    fetchActiveAcademicYears(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Half Term Configuration</h1>
      <HalfTermManager year={year} activeYears={activeYears} initialHalfTerms={halfTerms ?? []} />
    </div>
  )
}
