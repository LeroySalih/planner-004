import { query } from "@/lib/db"
import type { Queryable } from "@/lib/curriculum/unit-curriculum-guard"
import {
  DETERMINISTIC_ACTIVITY_TYPES,
  NON_SCORABLE_ACTIVITY_TYPES,
} from "@/dino.config"

// max_marks is derived for any activity with success criteria attached:
//   max_marks = Σ(binary → 1, levelled → descriptor count)
//
// Activities with NO criteria keep their manually-set max_marks and are left
// untouched — the join in the update below simply produces no row for them.
//
// A criterion is shared across activities, so changing its type or descriptor
// count changes max_marks everywhere it is used. Call
// recalculateMaxMarksForCriterion from those surfaces, not just the
// per-activity one.

// Two rules qualify the plain Σ:
//
//  - Deterministic types (MCQ, matcher, …) cap at 1. They produce a single
//    right/wrong, so attaching criteria must not inflate their weight.
//  - Non-scorable types are excluded entirely. They carry criteria for
//    curriculum mapping only; max_marks is meaningless for them.
const DETERMINISTIC_TYPES_SQL = DETERMINISTIC_ACTIVITY_TYPES.map((t) => `'${t}'`).join(", ")
const NON_SCORABLE_TYPES_SQL = NON_SCORABLE_ACTIVITY_TYPES.map((t) => `'${t}'`).join(", ")

/**
 * SQL fragment computing available marks per activity.
 *
 * Ends part-way through a WHERE clause: callers continue it with AND, never a
 * second WHERE. Two WHEREs in a row is a syntax error, and because this only
 * runs for an activity that has criteria attached, it failed quietly in a
 * corner rather than anywhere obvious.
 */
const AVAILABLE_MARKS_SUBQUERY = `
  select acs.activity_id,
         case
           when act.type in (${DETERMINISTIC_TYPES_SQL}) then 1
           else sum(
             case when sc.sc_type = 'levelled'
                  then greatest(1, (
                    select count(*)
                    from success_criteria_descriptors d
                    where d.success_criteria_id = sc.success_criteria_id
                  ))
                  else 1
             end
           )::int
         end as available
  from activity_success_criteria acs
  join success_criteria sc on sc.success_criteria_id = acs.success_criteria_id
  join activities act on act.activity_id = acs.activity_id
  where act.type not in (${NON_SCORABLE_TYPES_SQL})
`

/**
 * One statement: work out which activities change, rescale the marks already
 * stored against their old max_marks, then write the new max_marks.
 *
 * `filter` continues AVAILABLE_MARKS_SUBQUERY's WHERE clause, so it always
 * starts with `and`.
 *
 * The rescale is not optional housekeeping. Absolute marks in submissions.body
 * (marks_override, ai_marks, marks) only mean anything against max_marks, so
 * moving max_marks without moving them rewrites the score of work that was
 * already marked — migration 097 found 514 pupil scores reading 35.7% where
 * the teacher had given 90.3%, purely from criterion edits.
 *
 * `changed` is evaluated once against the pre-update snapshot, so the rescale
 * sees the old max_marks even though the sibling CTE is replacing it. Postgres
 * runs every data-modifying CTE to completion whether or not the primary query
 * reads it.
 */
function recalculateStatement(filter: string): string {
  return `
    with changed as (
      select a.activity_id, a.max_marks as old_max, totals.available as new_max
      from activities a
      join (
        ${AVAILABLE_MARKS_SUBQUERY}
        ${filter}
        group by acs.activity_id, act.type
      ) totals on totals.activity_id = a.activity_id
      where a.max_marks is distinct from totals.available
    ),
    rescaled as (
      update submissions s
      set body = rescale_submission_marks(s.body::jsonb, c.old_max, c.new_max)::json
      from changed c
      where s.activity_id = c.activity_id
      returning s.submission_id
    ),
    updated as (
      update activities a
      set max_marks = c.new_max
      from changed c
      where a.activity_id = c.activity_id
      returning a.activity_id
    )
    select activity_id from updated`
}

/**
 * Recalculate max_marks for a single activity from its linked criteria.
 * No-op for activities with no criteria.
 */
export async function recalculateActivityMaxMarks(
  db: Queryable,
  activityId: string,
): Promise<void> {
  await db.query(
    recalculateStatement("and acs.activity_id = $1"),
    [activityId],
  )
}

/**
 * Recalculate max_marks for every activity linked to a criterion. Call after
 * changing an SC's type or its descriptors — both change how many marks the
 * criterion contributes wherever it is used.
 *
 * Returns the number of activities whose max_marks actually changed, so callers
 * can warn a teacher before a destructive edit.
 */
export async function recalculateMaxMarksForCriterion(
  db: Queryable,
  successCriteriaId: string,
): Promise<number> {
  const { rows } = await db.query<{ activity_id: string }>(
    recalculateStatement(`and acs.activity_id in (
         select activity_id from activity_success_criteria
         where success_criteria_id = $1
       )`),
    [successCriteriaId],
  )

  return rows.length
}

/**
 * Move the marks already stored for one activity from one max_marks to
 * another. recalculateStatement does this for the derived path; this is for
 * the one place a teacher sets max_marks by hand, on an activity with no
 * criteria attached, where derivation is a no-op and would not otherwise run.
 */
export async function rescaleStoredMarks(
  db: Queryable,
  activityId: string,
  oldMax: number | null,
  newMax: number | null,
): Promise<void> {
  if (!oldMax || !newMax || oldMax <= 0 || newMax <= 0 || oldMax === newMax) {
    return
  }
  await db.query(
    `update submissions
     set body = rescale_submission_marks(body::jsonb, $2, $3)::json
     where activity_id = $1`,
    [activityId, oldMax, newMax],
  )
}

/**
 * How many activities a criterion is used by, and what their max_marks would
 * become. Used to warn before switching levelled → binary, which deletes
 * descriptors and lowers max_marks on every one of them.
 */
export async function countActivitiesUsingCriterion(
  successCriteriaId: string,
): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `select count(*)::text as count
     from activity_success_criteria
     where success_criteria_id = $1`,
    [successCriteriaId],
  )

  return Number(rows[0]?.count ?? 0)
}
