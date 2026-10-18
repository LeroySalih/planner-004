'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { withDbClient } from '@/lib/db'
import { TOP_LEVELS, type YearGroupLevels } from '@/lib/levels'
import { readYearGroupLevels } from '@/lib/levels/store'

// The top level each year group can be awarded (/admin/levels). Admin only.

type Result<T> = { data: T | null; error: string | null }

const RangeSchema = z.object({
  yearGroup: z.number().int().min(1, 'Year groups run 1 to 13.').max(13, 'Year groups run 1 to 13.'),
  topLevel: z.string().refine((level) => TOP_LEVELS.includes(level), { message: 'The top level must be 1L to 9H.' }),
})

const RangesSchema = z.array(RangeSchema).refine(
  (ranges) => new Set(ranges.map((range) => range.yearGroup)).size === ranges.length,
  { message: 'Each year group can appear only once.' },
)

export async function readYearGroupLevelsAction(): Promise<Result<YearGroupLevels[]>> {
  try {
    await requireRole('admin')
    return { data: await readYearGroupLevels(), error: null }
  } catch (error) {
    unstable_rethrow(error)
    console.error('[levels] read failed', error)
    return { data: null, error: 'Could not load the levels.' }
  }
}

/** Replaces every range: a year group left out no longer gets a level. */
export async function saveYearGroupLevelsAction(input: YearGroupLevels[]): Promise<Result<YearGroupLevels[]>> {
  try {
    const profile = await requireRole('admin')
    const parsed = RangesSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { data: null, error: issue?.message ?? 'Invalid levels.' }
    }
    await withDbClient(async (db) => {
      await db.query('begin')
      try {
        await db.query('delete from year_group_levels where not (year_group = any($1::int[]))', [
          parsed.data.map((range) => range.yearGroup),
        ])
        for (const range of parsed.data) {
          await db.query(
            `insert into year_group_levels (year_group, top_level, updated_at, updated_by)
             values ($1, $2, now(), $3)
             on conflict (year_group) do update
               set top_level = excluded.top_level, updated_at = now(), updated_by = excluded.updated_by
             where year_group_levels.top_level is distinct from excluded.top_level`,
            [range.yearGroup, range.topLevel, profile.userId],
          )
        }
        await db.query('commit')
      } catch (error) {
        await db.query('rollback')
        throw error
      }
    })
    revalidatePath('/admin/levels')
    revalidatePath('/unit-progress-reports', 'layout')
    revalidatePath('/group-progress-reports', 'layout')
    revalidatePath('/reports', 'layout')
    return { data: await readYearGroupLevels(), error: null }
  } catch (error) {
    unstable_rethrow(error)
    console.error('[levels] save failed', error)
    return { data: null, error: 'Could not save the levels.' }
  }
}
