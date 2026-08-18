'use server'

import { z } from 'zod'
import { query, withDbClient } from '@/lib/db'
import { requireRole, requireTeacherProfile } from '@/lib/auth'
import { SchoolYearSchema } from '@/types'

const SchoolYearsResult = z.object({
  data: z.array(SchoolYearSchema).nullable(),
  error: z.string().nullable(),
})

const NullResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

export async function readSchoolYearsAction(): Promise<z.infer<typeof SchoolYearsResult>> {
  try {
    await requireRole('admin')
    const { rows } = await query<Record<string, unknown>>(
      `SELECT year, label, active, is_current FROM school_years ORDER BY year DESC`,
    )
    return SchoolYearsResult.parse({ data: rows.map((r) => SchoolYearSchema.parse(r)), error: null })
  } catch (e) {
    return SchoolYearsResult.parse({ data: null, error: String(e) })
  }
}

export async function readActiveSchoolYearsAction(): Promise<z.infer<typeof SchoolYearsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT year, label, active, is_current FROM school_years WHERE active = true ORDER BY year DESC`,
    )
    return SchoolYearsResult.parse({ data: rows.map((r) => SchoolYearSchema.parse(r)), error: null })
  } catch (e) {
    return SchoolYearsResult.parse({ data: null, error: String(e) })
  }
}

export async function upsertSchoolYearAction(
  year: number,
  label: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireRole('admin')
    await query(
      `INSERT INTO school_years (year, label, active)
       VALUES ($1, $2, true)
       ON CONFLICT (year) DO UPDATE SET label = EXCLUDED.label`,
      [year, label],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

export async function setSchoolYearActiveAction(
  year: number,
  active: boolean,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireRole('admin')
    // Clearing `active` also clears `is_current`: an inactive year must not
    // remain the app-wide default, or every year selector would open on a year
    // it no longer offers.
    await query(
      `UPDATE school_years
       SET active = $2,
           is_current = CASE WHEN $2 THEN is_current ELSE false END
       WHERE year = $1`,
      [year, active],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

/**
 * Mark one school year as the app-wide default.
 *
 * Done in a transaction because the partial unique index allows only one
 * current year — clearing and setting in two statements would fail on the
 * insert half if anything ran between them.
 *
 * Only an active year may be current; the app would otherwise default to a year
 * missing from every selector.
 */
export async function setCurrentSchoolYearAction(
  year: number,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireRole('admin')

    await withDbClient(async (client) => {
      await client.query('BEGIN')
      try {
        const { rows } = await client.query<{ active: boolean }>(
          `SELECT active FROM school_years WHERE year = $1`,
          [year],
        )
        if (!rows[0]) throw new Error(`School year ${year} not found.`)
        if (!rows[0].active) throw new Error('Activate the year before making it current.')

        await client.query(`UPDATE school_years SET is_current = false WHERE is_current`)
        await client.query(`UPDATE school_years SET is_current = true WHERE year = $1`, [year])
        await client.query('COMMIT')
      } catch (inner) {
        await client.query('ROLLBACK')
        throw inner
      }
    })

    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({
      data: null,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * The year flagged current, or null when none is set. Unauthenticated-safe
 * internals: this is read by page-level defaults, not exposed as an action.
 */
export async function readCurrentSchoolYear(): Promise<number | null> {
  try {
    const { rows } = await query<{ year: number }>(
      `SELECT year FROM school_years WHERE is_current AND active LIMIT 1`,
    )
    return rows[0]?.year ?? null
  } catch {
    return null
  }
}
