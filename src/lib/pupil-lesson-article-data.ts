import { query } from "@/lib/db"
import { DUE_AFTER_DAYS } from "@/lib/lesson-due-date"

export type CourseUnitStatus = "done" | "current" | "upcoming" | "behind" | "in-progress"

export type CourseUnit = {
  unitId: string
  title: string
  firstLessonDate: string | null
  status: CourseUnitStatus
  /** Started lessons with work still missing. Shown on a current unit too. */
  overdueLessons: number
}

const isoDate = (value: Date | string | null) =>
  value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

/**
 * Every unit set to a class, in order of its first lesson, with where the
 * pupil stands in it. A lesson is overdue once its due date (a week after it
 * is taught, lib/lesson-due-date) has passed and any of its scorable
 * activities has no submission from the pupil (the progress baseline's rule:
 * pupil_activity_scores, migration 117).
 */
export async function loadCourseUnits(groupId: string, pupilId: string, currentUnitId: string | null): Promise<CourseUnit[]> {
  const { rows } = await query<{
    unit_id: string
    title: string | null
    first_date: Date | string | null
    last_date: Date | string | null
    overdue: number
    today: Date | string
  }>(
    `with unit_lessons as (
       select l.unit_id, u.title, la.start_date
         from lesson_assignments la
         join lessons l on l.lesson_id = la.lesson_id
         join units u on u.unit_id = l.unit_id
        where la.group_id = $1
          and la.hidden is not true
          and l.kind = 'standard'
          and l.active is not false
          and l.hidden_from_pupils is not true
          and u.active is not false
     ), overdue as (
       select pas.unit_id, count(distinct pas.lesson_id)::int as n
         from pupil_activity_scores pas
        where pas.group_id = $1 and pas.pupil_id = $2
          and pas.submission_id is null
          and pas.start_date + $3::int < current_date
        group by pas.unit_id
     )
     select ul.unit_id, max(ul.title) as title,
            min(ul.start_date) as first_date, max(ul.start_date) as last_date,
            coalesce(max(o.n), 0)::int as overdue, current_date as today
       from unit_lessons ul
       left join overdue o on o.unit_id = ul.unit_id
      group by ul.unit_id
      order by min(ul.start_date) asc nulls last, max(ul.title) asc`,
    [groupId, pupilId, DUE_AFTER_DAYS],
  )

  return rows.map((row) => {
    const today = isoDate(row.today)!
    const first = isoDate(row.first_date)
    const last = isoDate(row.last_date)
    const status: CourseUnitStatus =
      row.unit_id === currentUnitId
        ? "current"
        : first && first > today
          ? "upcoming"
          : row.overdue > 0
            ? "behind"
            : last && last < today
              ? "done"
              : "in-progress"
    return {
      unitId: row.unit_id,
      title: row.title?.trim() || row.unit_id,
      firstLessonDate: first,
      status,
      overdueLessons: row.overdue,
    }
  })
}

export type LessonPosition = {
  number: number | null
  total: number
  next: { lessonId: string; title: string } | null
}

/**
 * Where a lesson sits in its unit, and the next lesson the pupil's class has
 * been set. Without a class there is no next lesson to send them to.
 */
export async function loadLessonPosition(unitId: string, lessonId: string, groupId: string | null): Promise<LessonPosition> {
  const { rows } = await query<{ lesson_id: string; title: string; assigned: boolean }>(
    `select l.lesson_id, l.title,
            exists (select 1 from lesson_assignments la
                     where la.lesson_id = l.lesson_id and la.group_id = $2 and la.hidden is not true) as assigned
       from lessons l
      where l.unit_id = $1 and l.kind = 'standard' and l.active is not false and l.hidden_from_pupils is not true
      order by l.order_by asc nulls last, l.title asc`,
    [unitId, groupId],
  )
  const index = rows.findIndex((row) => row.lesson_id === lessonId)
  const next = index >= 0 ? rows.slice(index + 1).find((row) => row.assigned) : undefined
  return {
    number: index >= 0 ? index + 1 : null,
    total: rows.length,
    next: next ? { lessonId: next.lesson_id, title: next.title } : null,
  }
}

/** Activities the pupil has submitted anything for. */
export async function loadSubmittedActivityIds(pupilId: string, activityIds: string[]): Promise<string[]> {
  if (activityIds.length === 0) return []
  const { rows } = await query<{ activity_id: string }>(
    "select distinct activity_id from submissions where user_id = $1 and activity_id = any($2::text[])",
    [pupilId, activityIds],
  )
  return rows.map((row) => row.activity_id)
}
