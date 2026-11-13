import { z } from 'zod'

import { query } from '@/lib/db'

// The weekly planner's lesson dropdown: a unit's lessons, grouped by sub unit,
// each with the latest date it is planned for one class. Shared by the server action and
// its check, so callers do their own authorisation.
//
// Dates come from planner_assignments only. lesson_assignments is a view over
// that table (its start_date is the earliest week_start_date), so a lesson with
// a lesson_assignments row always has a planner row, and the planner row gives
// the actual day rather than the Sunday that starts the week.

export const PlannerUnitOverviewLessonSchema = z.object({
  lessonId: z.string(),
  title: z.string(),
  /** Latest planned date for the class, ISO YYYY-MM-DD, or null if not planned. */
  latestDate: z.string().nullable(),
  /** How many times it is planned for the class (0 when not planned). */
  occurrences: z.number().int(),
})

export const PlannerUnitOverviewSchema = z.object({
  unitId: z.string(),
  unitTitle: z.string(),
  groups: z.array(
    z.object({
      subUnitId: z.string().nullable(),
      /** Null for the only group of a unit with no sub units. */
      title: z.string().nullable(),
      lessons: z.array(PlannerUnitOverviewLessonSchema),
    }),
  ),
})

export type PlannerUnitOverview = z.infer<typeof PlannerUnitOverviewSchema>

type LessonRow = {
  lesson_id: string
  title: string
  sub_unit_id: string | null
  sub_unit_title: string | null
  latest_date: string | null
  occurrences: number
}

export async function readPlannerUnitOverview(unitId: string, groupId: string): Promise<PlannerUnitOverview | null> {
  const [{ rows: unitRows }, { rows }] = await Promise.all([
    query<{ title: string }>('select title from units where unit_id = $1', [unitId]),
    // Lessons in unit order, as the planner lists them. A lesson planned in a
    // week is dated by its day: weeks start on Sunday.
    query<LessonRow>(
      `select l.lesson_id, l.title, su.sub_unit_id, su.title as sub_unit_title,
              p.latest_date::text as latest_date, coalesce(p.occurrences, 0)::int as occurrences
         from lessons l
         left join sub_units su on su.sub_unit_id = l.sub_unit_id and su.unit_id = l.unit_id
         left join lateral (
           select max(pa.week_start_date + case pa.day
                    when 'sunday' then 0 when 'monday' then 1 when 'tuesday' then 2
                    when 'wednesday' then 3 when 'thursday' then 4 end) as latest_date,
                  count(*) as occurrences
             from planner_assignments pa
            where pa.group_id = $2 and pa.lesson_id = l.lesson_id
         ) p on true
        where l.unit_id = $1
          and l.kind = 'standard'
          and l.active is not false
        order by l.order_by nulls last, l.title, l.lesson_id`,
      [unitId, groupId],
    ),
  ])
  if (unitRows.length === 0) return null
  return PlannerUnitOverviewSchema.parse({
    unitId,
    unitTitle: unitRows[0].title,
    groups: groupBySubUnit(rows),
  })
}

/**
 * A sub unit's lessons sit together in the unit's lesson order, so the sub
 * units come in the order of their first lesson, as on the unit page. Lessons
 * in no sub unit go last, headed "Other lessons" only when there are sub units.
 */
function groupBySubUnit(rows: LessonRow[]): PlannerUnitOverview['groups'] {
  const groups: PlannerUnitOverview['groups'] = []
  const bySubUnit = new Map<string, PlannerUnitOverview['groups'][number]>()
  const ungrouped: PlannerUnitOverview['groups'][number]['lessons'] = []
  for (const row of rows) {
    const lesson = {
      lessonId: row.lesson_id,
      title: row.title,
      latestDate: row.latest_date,
      occurrences: row.occurrences,
    }
    if (!row.sub_unit_id) {
      ungrouped.push(lesson)
      continue
    }
    let group = bySubUnit.get(row.sub_unit_id)
    if (!group) {
      group = { subUnitId: row.sub_unit_id, title: row.sub_unit_title, lessons: [] }
      bySubUnit.set(row.sub_unit_id, group)
      groups.push(group)
    }
    group.lessons.push(lesson)
  }
  if (ungrouped.length > 0) {
    groups.push({ subUnitId: null, title: groups.length > 0 ? 'Other lessons' : null, lessons: ungrouped })
  }
  return groups
}
