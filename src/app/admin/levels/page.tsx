import { YearGroupLevelsEditor } from '@/components/admin/YearGroupLevelsEditor'
import { readYearGroupLevelsAction } from '@/lib/server-updates'

// The top level each year group can be awarded. Read by every report
// that shows a level (src/lib/levels). The admin layout and the actions check
// the admin role.
export default async function YearGroupLevelsPage() {
  const { data, error } = await readYearGroupLevelsAction()

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Levels by year group</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          The highest level each year group can be awarded. Levels follow the Grade Boundary Calculator: each year
          runs 1L, 1M, 1H, 2L and so on up to its top level, in equal steps of the marks rounded to whole percents,
          with the top level starting one step below 100%. Anything below 1M is 1L. A year group that is not listed
          gets no level.
        </p>
      </div>
      {error || !data ? (
        <p className="text-sm text-destructive">{error ?? 'Could not load the levels.'}</p>
      ) : (
        <YearGroupLevelsEditor initial={data} />
      )}
    </div>
  )
}
