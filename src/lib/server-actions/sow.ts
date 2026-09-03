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

/** Carries the new row's id back, so the caller can act on it before a reload. */
const PlacementIdResult = z.object({
  data: z.string().nullable(),
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
    const { rows } = await query<{
      group_id: string
      subject: string
      lessons_total: number
      lessons_this_week: number
    }>(
      // Scoped to the class's own academic year — the one its id prefix names
      // and the one its card is filed under — because an all-time count
      // disagreed with the class's own SoW page, which readGroupSowLessonsAction
      // restricts to the span of that year's half-terms.
      //
      // A class id with no YY- prefix (HOME-SCHOOL, test rows) yields no
      // half-terms, so the range comes back null and every week counts. Better
      // an unscoped number than a silent zero.
      //
      // Weeks start Sunday, so the current week's Sunday is today minus its
      // day-of-week (DOW puts Sunday at 0) — the same date the planner keys
      // planner_assignments on.
      `SELECT g.group_id, g.subject,
              COALESCE(c.lessons_total, 0)     AS lessons_total,
              COALESCE(c.lessons_this_week, 0) AS lessons_this_week
         FROM groups g
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS lessons_total,
                  COUNT(*) FILTER (
                    WHERE pa.week_start_date = current_date - EXTRACT(DOW FROM current_date)::int
                  )::int AS lessons_this_week
             FROM planner_assignments pa
             JOIN lessons l ON l.lesson_id = pa.lesson_id
             LEFT JOIN LATERAL (
               SELECT MIN(ht.start_date) AS start_date, MAX(ht.end_date) AS end_date
                 FROM half_terms ht
                WHERE ht.year = 2000 + substring(g.group_id from '^(\\d{2})(?:-|$)')::int
             ) h ON true
            WHERE pa.group_id = g.group_id
              AND (h.start_date IS NULL
                   OR pa.week_start_date BETWEEN h.start_date AND h.end_date)
         ) c ON true
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
}): Promise<z.infer<typeof PlacementIdResult>> {
  try {
    const profile = await requireTeacherProfile()
    const halfTermName = HalfTermNameSchema.parse(input.halfTermName)
    // Appended after whatever is already planned in the cell. Timetabled units
    // are ordered separately, by the week their lessons fall in.
    //
    // The id goes back to the caller because placement_id is a uuid and the
    // remove action deletes by it: without a real one the grid held a
    // placeholder, and removing a just-added unit failed on the uuid cast
    // until the page was reloaded.
    const inserted = await query<{ placement_id: string }>(
      `INSERT INTO sow_unit_placements (group_id, year, half_term_name, unit_id, position, created_by)
       SELECT $1, $2, $3, $4,
              coalesce((SELECT max(position) + 1 FROM sow_unit_placements
                         WHERE group_id = $1 AND year = $2 AND half_term_name = $3), 0),
              $5
       ON CONFLICT (group_id, year, half_term_name, unit_id) DO NOTHING
       RETURNING placement_id`,
      [input.groupId, input.year, halfTermName, input.unitId, profile.userId],
    )

    // DO NOTHING returns no row, so a unit already planned here needs looking
    // up rather than treating as a failure — the cell ends up correct either way.
    let placementId = inserted.rows[0]?.placement_id ?? null
    if (!placementId) {
      const { rows } = await query<{ placement_id: string }>(
        `SELECT placement_id FROM sow_unit_placements
          WHERE group_id = $1 AND year = $2 AND half_term_name = $3 AND unit_id = $4`,
        [input.groupId, input.year, halfTermName, input.unitId],
      )
      placementId = rows[0]?.placement_id ?? null
    }
    return PlacementIdResult.parse({ data: placementId, error: null })
  } catch (e) {
    return PlacementIdResult.parse({ data: null, error: String(e) })
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

// ── Importing a plan from another group ───────────────────────────────────────

const SowImportSourceSchema = z.object({
  group_id: z.string(),
  subject: z.string().nullable(),
  /** Retired classes are valid sources — see readSowImportSourcesAction. */
  active: z.boolean().nullable(),
  unit_count: z.number().int(),
})

const SowImportSourcesResult = z.object({
  data: z.array(SowImportSourceSchema).nullable(),
  error: z.string().nullable(),
})

const SowImportResult = z.object({
  data: z.object({ added: z.number().int() }).nullable(),
  error: z.string().nullable(),
})

/**
 * What a group's grid holds, as (half-term name, unit) pairs.
 *
 * Both routes in, unioned: units whose lessons were actually timetabled, and
 * units someone planned by hand. Importing brings across whichever the source
 * has — for most groups today that is entirely the former, since nobody has
 * planned anything yet.
 *
 * Half-terms are matched on the date range alone rather than by looking up the
 * source group's academic year: ranges from different years do not overlap, so
 * the date already identifies the half-term unambiguously, and the caller is
 * spared having to know what year the source group belongs to.
 */
const SOURCE_GRID_CTE = `
  derived AS (
    SELECT pa.group_id, ht.name AS half_term_name, l.unit_id
      FROM planner_assignments pa
      JOIN lessons l ON l.lesson_id = pa.lesson_id
      JOIN half_terms ht ON pa.week_start_date BETWEEN ht.start_date AND ht.end_date
     GROUP BY pa.group_id, ht.name, l.unit_id
  ),
  planned AS (
    SELECT p.group_id, p.half_term_name, p.unit_id FROM sow_unit_placements p
  ),
  grid AS (
    SELECT * FROM derived UNION SELECT * FROM planned
  )
`

/**
 * Groups this teacher could import from, with how much each would bring.
 *
 * Unlike the /sow list, INACTIVE groups are included. Last year's classes are
 * deactivated when the year ends, and they are precisely the ones worth
 * importing from — 25-10-DT is inactive and holds a full year of delivery.
 * Filtering them out blocked the main reason for the feature. Importing only
 * reads the source, so there is nothing unsafe about a retired group; the UI
 * labels them so it is clear what you are copying from.
 */
export async function readSowImportSourcesAction(
  targetGroupId: string,
  targetTeacherId?: string,
): Promise<z.infer<typeof SowImportSourcesResult>> {
  try {
    const profile = await requireTeacherProfile()
    const teacherId = targetTeacherId ?? profile.userId
    await requireTeacherOrAdminAccess(teacherId)

    const { rows } = await query<Record<string, unknown>>(
      `WITH ${SOURCE_GRID_CTE}
       SELECT g.group_id, g.subject, g.active, count(gr.unit_id)::int AS unit_count
         FROM groups g
         LEFT JOIN grid gr ON gr.group_id = g.group_id
        WHERE g.group_id <> $2
          AND (${SOW_GROUP_ACCESS_PREDICATE})
        GROUP BY g.group_id, g.subject, g.active
        ORDER BY g.subject, g.group_id`,
      [teacherId, targetGroupId],
    )
    const data = rows.map((r) =>
      SowImportSourceSchema.parse({ ...r, unit_count: Number(r.unit_count) }),
    )
    return SowImportSourcesResult.parse({ data, error: null })
  } catch (e) {
    return SowImportSourcesResult.parse({ data: null, error: String(e) })
  }
}

/**
 * Copy another group's grid into this one as planned units.
 *
 * Everything arrives planned, never timetabled: green means lessons are
 * scheduled to *this* class, and an import cannot schedule lessons. Merging,
 * never replacing — ON CONFLICT DO NOTHING leaves anything already in a cell
 * untouched, so importing twice is harmless and no existing planning is lost.
 */
export async function importSowUnitsFromGroupAction(input: {
  targetGroupId: string
  targetYear: number
  sourceGroupId: string
}): Promise<z.infer<typeof SowImportResult>> {
  try {
    const profile = await requireTeacherProfile()

    const { rows } = await query<{ placement_id: string }>(
      `WITH ${SOURCE_GRID_CTE}
       INSERT INTO sow_unit_placements
              (group_id, year, half_term_name, unit_id, position, created_by)
       SELECT $1, $2, gr.half_term_name, gr.unit_id,
              coalesce((SELECT max(position) + 1 FROM sow_unit_placements ex
                         WHERE ex.group_id = $1 AND ex.year = $2
                           AND ex.half_term_name = gr.half_term_name), 0),
              $4
         FROM grid gr
         JOIN units u ON u.unit_id = gr.unit_id
        WHERE gr.group_id = $3
       ON CONFLICT (group_id, year, half_term_name, unit_id) DO NOTHING
       RETURNING placement_id`,
      [input.targetGroupId, input.targetYear, input.sourceGroupId, profile.userId],
    )

    return SowImportResult.parse({ data: { added: rows.length }, error: null })
  } catch (e) {
    return SowImportResult.parse({ data: null, error: String(e) })
  }
}

const PlannerSowUnitSchema = z.object({ group_id: z.string(), unit_id: z.string() })

const PlannerSowUnitsResult = z.object({
  data: z.array(PlannerSowUnitSchema).nullable(),
  error: z.string().nullable(),
})

/**
 * Units that belong to the scheme of work for the half-term a given week falls
 * in, per group — so the planner can surface them at the top of its unit
 * dropdown instead of burying them in an alphabetical list of everything.
 *
 * Same definition as the /sow grid: units already timetabled to the group in
 * that half-term, plus units planned into it by hand. Both are what a teacher
 * means by "what I'm teaching this half-term".
 *
 * The half-term is found from the week's date alone — ranges do not overlap
 * across years — so the caller does not have to know the academic year. A week
 * in a holiday falls in no half-term and simply yields nothing, leaving the
 * dropdown as it was.
 */
export async function readPlannerSowUnitsAction(
  weekStartDate: string,
): Promise<z.infer<typeof PlannerSowUnitsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `WITH ht AS (
         SELECT year, name, start_date, end_date
           FROM half_terms
          WHERE $1::date BETWEEN start_date AND end_date
          LIMIT 1
       )
       SELECT DISTINCT pa.group_id, l.unit_id
         FROM planner_assignments pa
         JOIN lessons l ON l.lesson_id = pa.lesson_id
         CROSS JOIN ht
        WHERE pa.week_start_date BETWEEN ht.start_date AND ht.end_date
       UNION
       SELECT DISTINCT p.group_id, p.unit_id
         FROM sow_unit_placements p
         CROSS JOIN ht
        WHERE p.year = ht.year AND p.half_term_name = ht.name`,
      [weekStartDate],
    )
    return PlannerSowUnitsResult.parse({
      data: rows.map((r) => PlannerSowUnitSchema.parse(r)),
      error: null,
    })
  } catch (e) {
    return PlannerSowUnitsResult.parse({ data: null, error: String(e) })
  }
}
