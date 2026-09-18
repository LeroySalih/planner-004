import "server-only"

// Shared enforcement for the unit↔curriculum link. A unit may only be assigned
// LOs/SCs from its single chosen curriculum. This guard is the SINGLE source of
// truth for that rule and MUST be called by every path that assigns an SC/LO to
// a unit, lesson or activity — app server actions, the MCP server, and the AI
// chat confirm flows — so enforcement is common across all of them.
//
// Semantics:
//  - Items whose assessment objective has no curriculum (bespoke, unit-owned
//    AOs where assessment_objectives.curriculum_id is null) are always allowed.
//  - If the unit has no curriculum yet, the first assigned curriculum item FIXES
//    the unit's curriculum (units.curriculum_id is set). This matches "the
//    curriculum can't be changed once an LO from it has been assigned".
//  - Otherwise the item's curriculum must equal the unit's; a mismatch throws
//    UnitCurriculumMismatchError.

/** Minimal shape shared by pg Pool, PoolClient and Client. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>
}

export class UnitCurriculumMismatchError extends Error {
  readonly unitId: string
  readonly unitCurriculumId: string
  readonly itemCurriculumId: string
  constructor(unitId: string, unitCurriculumId: string, itemCurriculumId: string) {
    super(
      `This item belongs to a different curriculum than the unit. The unit is locked to its curriculum; ` +
        `assign items from that curriculum only, or have an admin change the unit's curriculum first.`,
    )
    this.name = "UnitCurriculumMismatchError"
    this.unitId = unitId
    this.unitCurriculumId = unitCurriculumId
    this.itemCurriculumId = itemCurriculumId
  }
}

/** Curriculum of a success criterion (sc → lo → ao). Null if the AO is unit-owned (no curriculum). */
export async function curriculumIdForSuccessCriterion(db: Queryable, scId: string): Promise<string | null> {
  const { rows } = await db.query<{ curriculum_id: string | null }>(
    `select ao.curriculum_id
       from success_criteria sc
       join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
       join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
      where sc.success_criteria_id = $1
      limit 1`,
    [scId],
  )
  return rows[0]?.curriculum_id ?? null
}

/** Curriculum of a learning objective (lo → ao). Null if the AO is unit-owned (no curriculum). */
export async function curriculumIdForLearningObjective(db: Queryable, loId: string): Promise<string | null> {
  const { rows } = await db.query<{ curriculum_id: string | null }>(
    `select ao.curriculum_id
       from learning_objectives lo
       join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
      where lo.learning_objective_id = $1
      limit 1`,
    [loId],
  )
  return rows[0]?.curriculum_id ?? null
}

async function unitIdForLesson(db: Queryable, lessonId: string): Promise<string | null> {
  const { rows } = await db.query<{ unit_id: string | null }>(
    `select unit_id from lessons where lesson_id = $1 limit 1`,
    [lessonId],
  )
  return rows[0]?.unit_id ?? null
}

async function unitIdForActivity(db: Queryable, activityId: string): Promise<string | null> {
  const { rows } = await db.query<{ unit_id: string | null }>(
    `select l.unit_id
       from activities a
       join lessons l on l.lesson_id = a.lesson_id
      where a.activity_id = $1
      limit 1`,
    [activityId],
  )
  return rows[0]?.unit_id ?? null
}

async function unitCurriculumId(db: Queryable, unitId: string): Promise<string | null> {
  const { rows } = await db.query<{ curriculum_id: string | null }>(
    `select curriculum_id from units where unit_id = $1 limit 1`,
    [unitId],
  )
  return rows[0]?.curriculum_id ?? null
}

/**
 * Core check: throws UnitCurriculumMismatchError if `itemCurriculumId` is not
 * allowed for the unit. Fixes the unit's curriculum on first assignment.
 * `itemCurriculumId === null` (bespoke item) is always allowed.
 */
export async function assertCurriculumAllowedForUnit(
  db: Queryable,
  unitId: string,
  itemCurriculumId: string | null,
): Promise<void> {
  if (!itemCurriculumId) return
  const current = await unitCurriculumId(db, unitId)
  if (!current) {
    // First curriculum item fixes the unit's curriculum (only when still null).
    await db.query(
      `update units set curriculum_id = $2 where unit_id = $1 and curriculum_id is null`,
      [unitId, itemCurriculumId],
    )
    return
  }
  if (current !== itemCurriculumId) {
    throw new UnitCurriculumMismatchError(unitId, current, itemCurriculumId)
  }
}

export async function assertScAllowedForUnit(db: Queryable, unitId: string, scId: string): Promise<void> {
  await assertCurriculumAllowedForUnit(db, unitId, await curriculumIdForSuccessCriterion(db, scId))
}

export async function assertLoAllowedForUnit(db: Queryable, unitId: string, loId: string): Promise<void> {
  await assertCurriculumAllowedForUnit(db, unitId, await curriculumIdForLearningObjective(db, loId))
}

export async function assertScAllowedForLesson(db: Queryable, lessonId: string, scId: string): Promise<void> {
  const unitId = await unitIdForLesson(db, lessonId)
  if (!unitId) return
  await assertScAllowedForUnit(db, unitId, scId)
}

export async function assertLoAllowedForLesson(db: Queryable, lessonId: string, loId: string): Promise<void> {
  const unitId = await unitIdForLesson(db, lessonId)
  if (!unitId) return
  await assertLoAllowedForUnit(db, unitId, loId)
}

export async function assertScAllowedForActivity(db: Queryable, activityId: string, scId: string): Promise<void> {
  const unitId = await unitIdForActivity(db, activityId)
  if (!unitId) return
  await assertScAllowedForUnit(db, unitId, scId)
}

/**
 * Remove all traces of a curriculum's LOs/SCs from a unit: the unit-level SC
 * assignment AND the LO/SC links on the unit's lessons and activities. Used
 * when an admin drops a curriculum from a multi-curriculum unit. Does NOT delete
 * the SCs/LOs themselves or any pupil feedback — only the unit/lesson/activity
 * links. Run inside a transaction. Returns the number of link rows removed.
 */
export async function removeCurriculumFromUnit(
  db: Queryable,
  unitId: string,
  curriculumId: string,
): Promise<number> {
  const scOfCurriculum = `
    select sc.success_criteria_id
      from success_criteria sc
      join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
      join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
     where ao.curriculum_id = $2`
  const loOfCurriculum = `
    select lo.learning_objective_id
      from learning_objectives lo
      join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
     where ao.curriculum_id = $2`
  const unitLessons = `select lesson_id from lessons where unit_id = $1`
  const unitActivities = `
    select a.activity_id from activities a
      join lessons l on l.lesson_id = a.lesson_id
     where l.unit_id = $1`

  let removed = 0
  const run = async (sql: string) => {
    const { rows } = await db.query<{ n: string }>(sql, [unitId, curriculumId])
    removed += Number(rows[0]?.n ?? 0)
  }

  // success_criteria_units (unit-level assignment)
  await run(
    `with del as (
       delete from success_criteria_units
        where unit_id = $1 and success_criteria_id in (${scOfCurriculum})
       returning 1)
     select count(*)::text as n from del`,
  )
  // lessons_learning_objective (LOs on the unit's lessons)
  await run(
    `with del as (
       delete from lessons_learning_objective
        where lesson_id in (${unitLessons}) and learning_objective_id in (${loOfCurriculum})
       returning 1)
     select count(*)::text as n from del`,
  )
  // lesson_success_criteria (SCs on the unit's lessons)
  await run(
    `with del as (
       delete from lesson_success_criteria
        where lesson_id in (${unitLessons}) and success_criteria_id in (${scOfCurriculum})
       returning 1)
     select count(*)::text as n from del`,
  )
  // activity_success_criteria (SCs on the unit's activities)
  await run(
    `with del as (
       delete from activity_success_criteria
        where activity_id in (${unitActivities}) and success_criteria_id in (${scOfCurriculum})
       returning 1)
     select count(*)::text as n from del`,
  )
  return removed
}

// Every (unit, curriculum, lo, sc) tuple the unit touches across all four
// assignment surfaces, restricted to curriculum-bearing AOs. Grouped downstream.
export const UNIT_ITEMS_CTE = `
  with unit_items as (
    select u.unit_id, ao.curriculum_id, lo.learning_objective_id as lo_id, sc.success_criteria_id as sc_id
    from units u
    join success_criteria_units scu on scu.unit_id = u.unit_id
    join success_criteria sc on sc.success_criteria_id = scu.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id, lo.learning_objective_id, null
    from lessons l
    join lessons_learning_objective llo on llo.lesson_id = l.lesson_id
    join learning_objectives lo on lo.learning_objective_id = llo.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id, lo.learning_objective_id, sc.success_criteria_id
    from lessons l
    join lesson_success_criteria lsc on lsc.lesson_id = l.lesson_id
    join success_criteria sc on sc.success_criteria_id = lsc.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id, lo.learning_objective_id, sc.success_criteria_id
    from lessons l
    join activities a on a.lesson_id = l.lesson_id
    join activity_success_criteria asc2 on asc2.activity_id = a.activity_id
    join success_criteria sc on sc.success_criteria_id = asc2.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
  ),
  per_unit as (
    select unit_id, count(distinct curriculum_id) as curr_count from unit_items group by unit_id
  )`

/**
 * Point each unit at the curriculum its objectives actually come from.
 *
 * units.curriculum_id is stamped once, on the first assignment, and nothing
 * updated it afterwards. Moving a learning objective to another curriculum
 * therefore left every unit using it pointing at the old one: the unit page
 * showed the wrong curriculum, the Edit dialog locked it (objectives are
 * assigned), Admin → Unit Curricula did not list it (it only lists units
 * spanning two curricula), and the guard above would then reject adding any
 * more objectives from the curriculum the unit really uses.
 *
 * Only units whose objectives all come from ONE curriculum are touched. A unit
 * left spanning two is a real conflict for a person to resolve, and Admin →
 * Unit Curricula lists it.
 *
 * `loId` limits it to units using that objective; omit it to sweep every unit.
 */
export async function restampUnitCurricula(db: Queryable, loId?: string): Promise<string[]> {
  const { rows } = await db.query<{ unit_id: string }>(
    `${UNIT_ITEMS_CTE}
     update units u
     set curriculum_id = single.curriculum_id
     from (
       select unit_id, min(curriculum_id) as curriculum_id
       from unit_items
       group by unit_id
       having count(distinct curriculum_id) = 1
     ) single
     where u.unit_id = single.unit_id
       and u.curriculum_id is distinct from single.curriculum_id
       ${loId ? "and u.unit_id in (select unit_id from unit_items where lo_id = $1)" : ""}
     returning u.unit_id`,
    loId ? [loId] : [],
  )
  return rows.map((row) => row.unit_id)
}
