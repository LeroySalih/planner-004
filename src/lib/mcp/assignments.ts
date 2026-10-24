import { query } from '@/lib/db'
import { lessonDueDate } from '@/lib/lesson-due-date'

/**
 * Read-only view of which lessons each class has been given, and when.
 *
 * The planner is the source: one planner_assignments row per timetable slot a
 * lesson is taught in. The lesson_assignments view collapses those to one row
 * per (class, lesson) with start_date = the earliest slot's week, which is
 * the date the rest of the app (progress, My Units, due dates) works from.
 * Both are returned so a caller sees the rule and the sessions behind it.
 */

export type LessonAssignmentSession = {
  date: string
  week_start_date: string
  day: string
  period: number
}

export type LessonAssignment = {
  group_id: string
  group_subject: string | null
  lesson_id: string
  lesson_title: string
  unit_id: string
  unit_title: string
  start_date: string
  due_date: string | null
  locked: boolean
  feedback_visible: boolean
  sessions: LessonAssignmentSession[]
}

export type LessonAssignmentFilter = {
  groupId?: string
  unitId?: string
  lessonId?: string
  from?: string
  to?: string
  includeInactive?: boolean
}

const DAY_OFFSETS = "('sunday',0),('monday',1),('tuesday',2),('wednesday',3),('thursday',4)"

/**
 * Assignments matching the filter, newest first. `from` / `to` (yyyy-MM-dd,
 * inclusive) match the assignment's start_date. Retired classes are left out
 * unless asked for or named by group_id.
 */
export async function listLessonAssignments(filter: LessonAssignmentFilter): Promise<LessonAssignment[]> {
  const includeInactive = filter.includeInactive === true || Boolean(filter.groupId)
  const { rows } = await query(
    `WITH sessions AS (
       SELECT pa.group_id, pa.lesson_id,
              (pa.week_start_date + d.offset_days)::text AS date,
              pa.week_start_date::text AS week_start_date,
              pa.day, pa.period
         FROM planner_assignments pa
         JOIN (VALUES ${DAY_OFFSETS}) AS d(day, offset_days) ON d.day = pa.day
     )
     SELECT la.group_id, g.subject AS group_subject,
            la.lesson_id, l.title AS lesson_title,
            u.unit_id, u.title AS unit_title,
            la.start_date::text AS start_date,
            la.locked, la.feedback_visible,
            coalesce(
              (SELECT json_agg(json_build_object(
                        'date', s.date, 'week_start_date', s.week_start_date,
                        'day', s.day, 'period', s.period)
                      ORDER BY s.date, s.period)
                 FROM sessions s
                WHERE s.group_id = la.group_id AND s.lesson_id = la.lesson_id),
              '[]'::json) AS sessions
       FROM lesson_assignments la
       JOIN lessons l ON l.lesson_id = la.lesson_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN groups g ON g.group_id = la.group_id
      WHERE l.active IS NOT FALSE
        AND ($1::boolean OR g.active IS NOT FALSE)
        AND ($2::text IS NULL OR la.group_id = $2)
        AND ($3::text IS NULL OR u.unit_id = $3)
        AND ($4::text IS NULL OR la.lesson_id = $4)
        AND ($5::date IS NULL OR la.start_date >= $5::date)
        AND ($6::date IS NULL OR la.start_date <= $6::date)
      ORDER BY la.start_date DESC, la.group_id, l.order_by NULLS LAST, l.title`,
    [
      includeInactive,
      filter.groupId ?? null,
      filter.unitId ?? null,
      filter.lessonId ?? null,
      filter.from ?? null,
      filter.to ?? null,
    ],
  )

  return (rows ?? []).map((r) => ({
    group_id: String(r.group_id),
    group_subject: typeof r.group_subject === 'string' ? r.group_subject : null,
    lesson_id: String(r.lesson_id),
    lesson_title: typeof r.lesson_title === 'string' ? r.lesson_title : '',
    unit_id: String(r.unit_id),
    unit_title: typeof r.unit_title === 'string' ? r.unit_title : '',
    start_date: String(r.start_date),
    due_date: lessonDueDate(String(r.start_date)),
    locked: r.locked === true,
    feedback_visible: r.feedback_visible !== false,
    sessions: (r.sessions ?? []) as LessonAssignmentSession[],
  }))
}
