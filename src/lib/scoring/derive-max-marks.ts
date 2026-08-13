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

/** SQL fragment computing available marks per activity. */
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
 * Recalculate max_marks for a single activity from its linked criteria.
 * No-op for activities with no criteria.
 */
export async function recalculateActivityMaxMarks(
  db: Queryable,
  activityId: string,
): Promise<void> {
  await db.query(
    `update activities a
     set max_marks = totals.available
     from (
       ${AVAILABLE_MARKS_SUBQUERY}
       where acs.activity_id = $1
       group by acs.activity_id, act.type
     ) totals
     where a.activity_id = totals.activity_id
       and a.max_marks is distinct from totals.available`,
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
    `update activities a
     set max_marks = totals.available
     from (
       ${AVAILABLE_MARKS_SUBQUERY}
       where acs.activity_id in (
         select activity_id from activity_success_criteria
         where success_criteria_id = $1
       )
       group by acs.activity_id, act.type
     ) totals
     where a.activity_id = totals.activity_id
       and a.max_marks is distinct from totals.available
     returning a.activity_id`,
    [successCriteriaId],
  )

  return rows.length
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
