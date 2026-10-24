import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"

// A pupil's "How well do I understand this lesson?" answers (migration 125).

export type UnderstandingRating = "up" | "down"

export type LessonUnderstanding = {
  rating: UnderstandingRating
  recordedAt: string
}

export class LessonUnderstandingError extends Error {}

/** The pupil's current answer: their latest row, or null. */
export async function readLessonUnderstanding(
  db: Queryable,
  pupilId: string,
  lessonId: string,
): Promise<LessonUnderstanding | null> {
  const { rows } = await db.query<{ rating: UnderstandingRating; recorded_at: Date }>(
    `select rating, recorded_at from lesson_understanding
      where pupil_id = $1 and lesson_id = $2
      order by recorded_at desc limit 1`,
    [pupilId, lessonId],
  )
  return rows[0] ? { rating: rows[0].rating, recordedAt: new Date(rows[0].recorded_at).toISOString() } : null
}

/**
 * Records an answer. Only a lesson the pupil may see counts: one set to their
 * class (not hidden), or their own intervention. The same answer again on the
 * same day adds no row, so repeated presses do not swamp the history.
 */
export async function recordLessonUnderstanding(
  db: Queryable,
  pupilId: string,
  lessonId: string,
  rating: UnderstandingRating,
): Promise<LessonUnderstanding> {
  if (rating !== "up" && rating !== "down") throw new LessonUnderstandingError("Choose thumbs up or thumbs down.")

  const { rows: allowed } = await db.query(
    `select 1
       from lessons l
      where l.lesson_id = $2
        and l.active is not false
        and l.hidden_from_pupils is not true
        and (
          exists (select 1 from lesson_assignments la
                    join group_membership gm on gm.group_id = la.group_id and gm.user_id = $1
                   where la.lesson_id = l.lesson_id and la.hidden is not true)
          or exists (select 1 from intervention_assignments ia
                      where ia.lesson_id = l.lesson_id and ia.pupil_id = $1 and ia.active)
        )`,
    [pupilId, lessonId],
  )
  if (allowed.length === 0) throw new LessonUnderstandingError("This lesson is not one of yours.")

  const { rows } = await db.query<{ rating: UnderstandingRating; recorded_at: Date }>(
    `with latest as (
       select rating, recorded_at from lesson_understanding
        where pupil_id = $1 and lesson_id = $2
        order by recorded_at desc limit 1
     ), inserted as (
       insert into lesson_understanding (pupil_id, lesson_id, rating)
       select $1, $2, $3
        where not exists (
          select 1 from latest
           where latest.rating = $3 and latest.recorded_at::date = current_date)
       returning rating, recorded_at
     )
     select rating, recorded_at from inserted
     union all
     select rating, recorded_at from latest where not exists (select 1 from inserted)`,
    [pupilId, lessonId, rating],
  )
  return { rating: rows[0].rating, recordedAt: new Date(rows[0].recorded_at).toISOString() }
}
