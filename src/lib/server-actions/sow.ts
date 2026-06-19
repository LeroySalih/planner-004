'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile, requireRole } from '@/lib/auth'
import { HalfTermSchema, SowLessonPlanSchema, SowHalfTermUnitSchema, TeacherGroupSchema } from '@/types'

// ── Return shapes ─────────────────────────────────────────────────────────────

const HalfTermsResult = z.object({
  data: z.array(HalfTermSchema).nullable(),
  error: z.string().nullable(),
})

const HalfTermResult = z.object({
  data: HalfTermSchema.nullable(),
  error: z.string().nullable(),
})

const SowLessonPlanResult = z.object({
  data: z.array(SowLessonPlanSchema).nullable(),
  error: z.string().nullable(),
})

const SowHalfTermUnitsResult = z.object({
  data: z.array(SowHalfTermUnitSchema).nullable(),
  error: z.string().nullable(),
})

const NullResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIsoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

// ── Half term actions ─────────────────────────────────────────────────────────

export async function readHalfTermsAction(year: number): Promise<z.infer<typeof HalfTermsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, year, name, start_date, end_date
       FROM half_terms
       WHERE year = $1
       ORDER BY name`,
      [year],
    )
    const data = rows.map((r) =>
      HalfTermSchema.parse({
        ...r,
        start_date: toIsoDate(r.start_date),
        end_date: toIsoDate(r.end_date),
      }),
    )
    return HalfTermsResult.parse({ data, error: null })
  } catch (e) {
    return HalfTermsResult.parse({ data: null, error: String(e) })
  }
}

export async function upsertHalfTermAction(
  year: number,
  name: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6',
  startDate: string,
  endDate: string,
): Promise<z.infer<typeof HalfTermResult>> {
  try {
    await requireRole('admin')
    const { rows } = await query<Record<string, unknown>>(
      `INSERT INTO half_terms (year, name, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (year, name)
       DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
       RETURNING id, year, name, start_date, end_date`,
      [year, name, startDate, endDate],
    )
    const data = HalfTermSchema.parse({
      ...rows[0],
      start_date: toIsoDate(rows[0].start_date),
      end_date: toIsoDate(rows[0].end_date),
    })
    return HalfTermResult.parse({ data, error: null })
  } catch (e) {
    return HalfTermResult.parse({ data: null, error: String(e) })
  }
}

// ── SoW half-term units ───────────────────────────────────────────────────────

export async function readSowHalfTermUnitsAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowHalfTermUnitsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT shu.group_id, shu.half_term_id, shu.unit_id, u.subject AS unit_name, shu.position
       FROM sow_half_term_units shu
       JOIN half_terms ht ON ht.id = shu.half_term_id
       LEFT JOIN units u ON u.unit_id = shu.unit_id
       WHERE shu.group_id = $1 AND ht.year = $2
       ORDER BY ht.name, shu.position`,
      [groupId, year],
    )
    const data = rows.map((r) => SowHalfTermUnitSchema.parse(r))
    return SowHalfTermUnitsResult.parse({ data, error: null })
  } catch (e) {
    return SowHalfTermUnitsResult.parse({ data: null, error: String(e) })
  }
}

export async function addSowHalfTermUnitAction(
  groupId: string,
  halfTermId: string,
  unitId: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    const { rows: existing } = await query<{ position: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS position
       FROM sow_half_term_units
       WHERE group_id = $1 AND half_term_id = $2`,
      [groupId, halfTermId],
    )
    const position = existing[0]?.position ?? 0
    await query(
      `INSERT INTO sow_half_term_units (group_id, half_term_id, unit_id, position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [groupId, halfTermId, unitId, position],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

export async function removeSowHalfTermUnitAction(
  groupId: string,
  halfTermId: string,
  unitId: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    await query(
      `DELETE FROM sow_half_term_units
       WHERE group_id = $1 AND half_term_id = $2 AND unit_id = $3`,
      [groupId, halfTermId, unitId],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

// ── SoW lesson plan ───────────────────────────────────────────────────────────

export async function readSowLessonPlanAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowLessonPlanResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT slp.id, slp.group_id, slp.lesson_id, slp.unit_id,
              slp.week_start_date, slp.created_at
       FROM sow_lesson_plan slp
       JOIN half_terms h1 ON h1.year = $2 AND h1.name = 'H1'
       JOIN half_terms h6 ON h6.year = $2 AND h6.name = 'H6'
       WHERE slp.group_id = $1
         AND slp.week_start_date BETWEEN h1.start_date AND h6.end_date
       ORDER BY slp.week_start_date`,
      [groupId, year],
    )
    const data = rows.map((r) =>
      SowLessonPlanSchema.parse({
        ...r,
        week_start_date: toIsoDate(r.week_start_date),
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }),
    )
    return SowLessonPlanResult.parse({ data, error: null })
  } catch (e) {
    return SowLessonPlanResult.parse({ data: null, error: String(e) })
  }
}

export async function addSowLessonAction(
  groupId: string,
  lessonId: string,
  unitId: string,
  weekStartDate: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    await query(
      `INSERT INTO sow_lesson_plan (group_id, lesson_id, unit_id, week_start_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, lesson_id, week_start_date) DO NOTHING`,
      [groupId, lessonId, unitId, weekStartDate],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

export async function removeSowLessonAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    await query(
      `DELETE FROM sow_lesson_plan
       WHERE group_id = $1 AND lesson_id = $2 AND week_start_date = $3`,
      [groupId, lessonId, weekStartDate],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

// ── Teacher groups (for /sow landing page) ────────────────────────────────────

const TeacherGroupsResult = z.object({
  data: z.array(TeacherGroupSchema).nullable(),
  error: z.string().nullable(),
})

export async function readTeacherGroupsForSowAction(): Promise<z.infer<typeof TeacherGroupsResult>> {
  try {
    const profile = await requireTeacherProfile()
    const { rows } = await query<{ group_id: string; subject: string }>(
      `SELECT DISTINCT g.group_id, g.subject
       FROM timetable_slot_groups tsg
       JOIN groups g ON g.group_id = tsg.group_id
       WHERE tsg.teacher_id = $1 AND g.active IS NOT FALSE
       ORDER BY g.subject`,
      [profile.userId],
    )
    return TeacherGroupsResult.parse({ data: rows, error: null })
  } catch (e) {
    return TeacherGroupsResult.parse({ data: null, error: String(e) })
  }
}
