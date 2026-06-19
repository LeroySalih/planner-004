'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
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
      `SELECT year, label, active FROM school_years ORDER BY year DESC`,
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
      `SELECT year, label, active FROM school_years WHERE active = true ORDER BY year DESC`,
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
    await query(`UPDATE school_years SET active = $2 WHERE year = $1`, [year, active])
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}
