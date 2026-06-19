import { requireRole } from '@/lib/auth'
import { readHalfTermsAction } from '@/lib/server-updates'
import { HalfTermManager } from '@/components/admin/HalfTermManager'
import { currentAcademicYear } from '@/lib/academic-year'

export default async function AdminHalfTermsPage() {
  await requireRole('admin')

  const year = currentAcademicYear()
  const { data: halfTerms } = await readHalfTermsAction(year)

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Half Term Configuration</h1>
      <HalfTermManager year={year} initialHalfTerms={halfTerms ?? []} />
    </div>
  )
}
