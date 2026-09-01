'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile, requireRole, requireTeacherOrAdminAccess } from '@/lib/auth'
import {
  HalfTermNameSchema,
  HalfTermSchema,
  SowHalfTermUnitSchema,
  SowUnitNoteSchema,
  SowUnitPlacementSchema,
  TeacherGroupSchema,
} from '@/types'
import { validateHalfTermDates } from '@/lib/academic-year'
import { SOW_GROUP_ACCESS_PREDICATE } from '@/lib/sow/group-access'

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

const SowUnitPlacementsResult = z.object({
  data: z.array(SowUnitPlacementSchema).nullable(),
  error: z.string().nullable(),
})

const SowUnitNotesResult = z.object({
  data: z.array(SowUnitNoteSchema).nullable(),
  error: z.string().nullable(),
})

const MutationResult = z.object({
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
    const validationError = validateHalfTermDates(year, startDate, endDate)
    if (validationError) {
      return HalfTermResult.parse({ data: null, error: validationError })
    }
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
      `SELECT g.half_term_id, g.unit_id, u.title AS unit_name,
              (ROW_NUMBER() OVER (PARTITION BY g.half_term_id ORDER BY g.first_week, g.unit_id) - 1) AS position
       FROM (
         SELECT ht.id AS half_term_id, l.unit_id, MIN(pa.week_start_date) AS first_week
         FROM planner_assignments pa
         JOIN lessons l ON l.lesson_id = pa.lesson_id
         JOIN half_terms ht ON ht.year = $2 AND pa.week_start_date BETWEEN ht.start_date AND ht.end_date
         WHERE pa.group_id = $1
         GROUP BY ht.id, l.unit_id
       ) g
       LEFT JOIN units u ON u.unit_id = g.unit_id
       ORDER BY g.half_term_id, position`,
      [groupId, year],
    )
    const data = rows.map((r) =>
      SowHalfTermUnitSchema.parse({ ...r, group_id: groupId, position: Number(r.position) }),
    )
    return SowHalfTermUnitsResult.parse({ data, error: null })
  } catch (e) {
    return SowHalfTermUnitsResult.parse({ data: null, error: String(e) })
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
      `SELECT g.group_id, g.subject
         FROM groups g
        WHERE g.active IS NOT FALSE AND (${SOW_GROUP_ACCESS_PREDICATE})
        ORDER BY g.subject, g.group_id`,
      [resolvedTargetTeacherId],
    )
    return TeacherGroupsResult.parse({ data: rows, error: null })
  } catch (e) {
    return TeacherGroupsResult.parse({ data: null, error: String(e) })
  }
}


// ── Manual unit placement (organisational only) ───────────────────────────────
//
// These sit alongside the derived readSowHalfTermUnitsAction above rather than
// replacing it: a unit reaches the grid either because a teacher planned it
// here, or because its lessons are timetabled to the group. The grid shows
// both, and the merge lives in the component.

export async function readSowUnitPlacementsAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowUnitPlacementsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT p.placement_id, p.group_id, p.year, p.half_term_name, p.unit_id,
              u.title AS unit_name, p.position
         FROM sow_unit_placements p
         LEFT JOIN units u ON u.unit_id = p.unit_id
        WHERE p.group_id = $1 AND p.year = $2
        ORDER BY p.half_term_name, p.position, p.created_at`,
      [groupId, year],
    )
    const data = rows.map((r) =>
      SowUnitPlacementSchema.parse({ ...r, year: Number(r.year), position: Number(r.position) }),
    )
    return SowUnitPlacementsResult.parse({ data, error: null })
  } catch (e) {
    return SowUnitPlacementsResult.parse({ data: null, error: String(e) })
  }
}

export async function addSowUnitPlacementAction(input: {
  groupId: string
  year: number
  halfTermName: string
  unitId: string
}): Promise<z.infer<typeof MutationResult>> {
  try {
    const profile = await requireTeacherProfile()
    const halfTermName = HalfTermNameSchema.parse(input.halfTermName)
    // Appended after whatever is already planned in the cell. Timetabled units
    // are ordered separately, by the week their lessons fall in.
    await query(
      `INSERT INTO sow_unit_placements (group_id, year, half_term_name, unit_id, position, created_by)
       SELECT $1, $2, $3, $4,
              coalesce((SELECT max(position) + 1 FROM sow_unit_placements
                         WHERE group_id = $1 AND year = $2 AND half_term_name = $3), 0),
              $5
       ON CONFLICT (group_id, year, half_term_name, unit_id) DO NOTHING`,
      [input.groupId, input.year, halfTermName, input.unitId, profile.userId],
    )
    return MutationResult.parse({ data: null, error: null })
  } catch (e) {
    return MutationResult.parse({ data: null, error: String(e) })
  }
}

export async function removeSowUnitPlacementAction(
  placementId: string,
): Promise<z.infer<typeof MutationResult>> {
  try {
    await requireTeacherProfile()
    // Only ever removes the plan. A unit that is in the grid because its
    // lessons are timetabled has no placement row, so there is nothing here
    // that can take it out of the timetable.
    await query(`DELETE FROM sow_unit_placements WHERE placement_id = $1`, [placementId])
    return MutationResult.parse({ data: null, error: null })
  } catch (e) {
    return MutationResult.parse({ data: null, error: String(e) })
  }
}

export async function readSowUnitNotesAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowUnitNotesResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT group_id, year, half_term_name, unit_id, note
         FROM sow_unit_notes
        WHERE group_id = $1 AND year = $2`,
      [groupId, year],
    )
    const data = rows.map((r) => SowUnitNoteSchema.parse({ ...r, year: Number(r.year) }))
    return SowUnitNotesResult.parse({ data, error: null })
  } catch (e) {
    return SowUnitNotesResult.parse({ data: null, error: String(e) })
  }
}

export async function upsertSowUnitNoteAction(input: {
  groupId: string
  year: number
  halfTermName: string
  unitId: string
  note: string
}): Promise<z.infer<typeof MutationResult>> {
  try {
    const profile = await requireTeacherProfile()
    const halfTermName = HalfTermNameSchema.parse(input.halfTermName)
    const note = input.note.trim()

    // An empty note deletes the row rather than storing "". "Has a note" is
    // then simply the row existing, and a cleared note leaves nothing behind.
    if (note.length === 0) {
      await query(
        `DELETE FROM sow_unit_notes
          WHERE group_id = $1 AND year = $2 AND half_term_name = $3 AND unit_id = $4`,
        [input.groupId, input.year, halfTermName, input.unitId],
      )
      return MutationResult.parse({ data: null, error: null })
    }

    await query(
      `INSERT INTO sow_unit_notes (group_id, year, half_term_name, unit_id, note, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (group_id, year, half_term_name, unit_id)
       DO UPDATE SET note = EXCLUDED.note, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [input.groupId, input.year, halfTermName, input.unitId, note, profile.userId],
    )
    return MutationResult.parse({ data: null, error: null })
  } catch (e) {
    return MutationResult.parse({ data: null, error: String(e) })
  }
}
