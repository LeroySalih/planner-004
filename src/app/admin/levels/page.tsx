import { YearGroupLevelsEditor } from '@/components/admin/YearGroupLevelsEditor'
import { readYearGroupLevelsAction } from '@/lib/server-updates'

// The range of levels each year group can be awarded. Read by every report
// that shows a level (src/lib/levels). The admin layout and the actions check
// the admin role.
export default async function YearGroupLevelsPage() {
  const { data, error } = await readYearGroupLevelsAction()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Levels by year group</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          The lowest and highest level each year group can be awarded. A score is placed on the sub-levels from
          the lowest level&apos;s L to the highest level&apos;s H, spread evenly from 0% to 100%. A year group that
          is not listed gets no level.
        </p>
      </div>
      {error || !data ? (
        <p className="text-sm text-destructive">{error ?? 'Could not load the level ranges.'}</p>
      ) : (
        <YearGroupLevelsEditor initial={data} />
      )}
    </div>
  )
}
