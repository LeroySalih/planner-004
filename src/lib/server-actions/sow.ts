'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile, requireRole, requireTeacherOrAdminAccess } from '@/lib/auth'
import { HalfTermSchema, SowHalfTermUnitSchema, TeacherGroupSchema } from '@/types'

// ── Return shapes ─────────────────────────────────────────────────────────────

const HalfTermsResult = z.object({
  data: z.array(HalfTermSchema).nullable(),
  error: z.string().nullable(),
})

const HalfTermResult = z.object({
  data: HalfTermSchema.nullable(),
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
      `SELECT id, year, name, start_date::text, end_date::text
       FROM half_terms
       WHERE year = $1
       ORDER BY name`,
      [year],
    )
    const data = rows.map((r) => HalfTermSchema.parse(r))
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
       RETURNING id, year, name, start_date::text, end_date::text`,
      [year, name, startDate, endDate],
    )
    const data = HalfTermSchema.parse(rows[0])
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
      `SELECT shu.group_id, shu.half_term_id, shu.unit_id, u.title AS unit_name, shu.position
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

export async function assignHalfTermUnitsToGroupsAction(
  sourceGroupId: string,
  targetGroupIds: string[],
  year: number,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    if (targetGroupIds.length === 0) return NullResult.parse({ data: null, error: null })
    for (const targetGroupId of targetGroupIds) {
      await query(
        `INSERT INTO sow_half_term_units (group_id, half_term_id, unit_id, position)
         SELECT $2, shu.half_term_id, shu.unit_id, shu.position
         FROM sow_half_term_units shu
         JOIN half_terms ht ON ht.id = shu.half_term_id
         WHERE shu.group_id = $1 AND ht.year = $3
         ON CONFLICT DO NOTHING`,
        [sourceGroupId, targetGroupId, year],
      )
    }
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

export async function readTeacherGroupsForSowAction(
  targetTeacherId?: string,
): Promise<z.infer<typeof TeacherGroupsResult>> {
  try {
    const profile = await requireTeacherProfile()
    const resolvedTargetTeacherId = targetTeacherId ?? profile.userId
    await requireTeacherOrAdminAccess(resolvedTargetTeacherId)
    const { rows } = await query<{ group_id: string; subject: string }>(
      `SELECT DISTINCT g.group_id, g.subject
       FROM timetable_slot_groups tsg
       JOIN groups g ON g.group_id = tsg.group_id
       WHERE tsg.teacher_id = $1 AND g.active IS NOT FALSE
       ORDER BY g.subject`,
      [resolvedTargetTeacherId],
    )
    return TeacherGroupsResult.parse({ data: rows, error: null })
  } catch (e) {
    return TeacherGroupsResult.parse({ data: null, error: String(e) })
  }
}
