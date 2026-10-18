'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { withDbClient } from '@/lib/db'
import { MAX_LEVEL, MIN_LEVEL, type YearGroupLevels } from '@/lib/levels'
import { readYearGroupLevels } from '@/lib/levels/store'

// The level range each year group can be awarded (/admin/levels). Admin only.

type Result<T> = { data: T | null; error: string | null }

const RangeSchema = z
  .object({
    yearGroup: z.number().int().min(1, 'Year groups run 1 to 13.').max(13, 'Year groups run 1 to 13.'),
    minLevel: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
    maxLevel: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
  })
  .refine((range) => range.minLevel <= range.maxLevel, {
    message: 'The lowest level cannot be above the highest.',
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
    return { data: null, error: 'Could not load the level ranges.' }
  }
}

/** Replaces every range: a year group left out no longer gets a level. */
export async function saveYearGroupLevelsAction(input: YearGroupLevels[]): Promise<Result<YearGroupLevels[]>> {
  try {
    const profile = await requireRole('admin')
    const parsed = RangesSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { data: null, error: issue?.message ?? 'Invalid level ranges.' }
    }
    await withDbClient(async (db) => {
      await db.query('begin')
      try {
        await db.query('delete from year_group_levels where not (year_group = any($1::int[]))', [
          parsed.data.map((range) => range.yearGroup),
        ])
        for (const range of parsed.data) {
          await db.query(
            `insert into year_group_levels (year_group, min_level, max_level, updated_at, updated_by)
             values ($1, $2, $3, now(), $4)
             on conflict (year_group) do update
               set min_level = excluded.min_level, max_level = excluded.max_level,
                   updated_at = now(), updated_by = excluded.updated_by
             where (year_group_levels.min_level, year_group_levels.max_level)
                   is distinct from (excluded.min_level, excluded.max_level)`,
            [range.yearGroup, range.minLevel, range.maxLevel, profile.userId],
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
    revalidatePath('/reports', 'layout')
    return { data: await readYearGroupLevels(), error: null }
  } catch (error) {
    unstable_rethrow(error)
    console.error('[levels] save failed', error)
    return { data: null, error: 'Could not save the level ranges.' }
  }
}
