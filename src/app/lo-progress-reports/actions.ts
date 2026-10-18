'use server'

import { query } from '@/lib/db'
import { requireAuthenticatedProfile } from '@/lib/auth'
import { resolvePupilIds } from "@/lib/roles/pupil-membership"

// The learning objectives of each unit a class studies (any lesson of the
// unit set to it), whether scored yet or not, so a report can show an LO the
// class has not reached yet in grey. An LO is part of a unit through its
// success criteria (success_criteria_units) or a lesson of the unit
// (lessons_learning_objective). It is "set" for a class once a lesson set to
// the class links to it: by lessons_learning_objective, lesson_success_criteria
// or a criterion on one of the lesson's activities.
const CLASS_UNIT_LOS_SQL = `
  unit_los AS (
    SELECT sc.learning_objective_id AS lo_id, scu.unit_id
    FROM success_criteria_units scu
    JOIN success_criteria sc ON sc.success_criteria_id = scu.success_criteria_id
    WHERE sc.active IS NOT FALSE AND sc.learning_objective_id IS NOT NULL
    UNION
    SELECT llo.learning_objective_id, l.unit_id
    FROM lessons_learning_objective llo
    JOIN lessons l ON l.lesson_id = llo.lesson_id
    WHERE llo.active IS NOT FALSE AND l.active IS NOT FALSE AND l.kind = 'standard'
  ),
  class_units AS (
    SELECT DISTINCT la.group_id, l.unit_id
    FROM lesson_assignments la
    JOIN lessons l ON l.lesson_id = la.lesson_id
    WHERE l.active IS NOT FALSE AND l.kind = 'standard'
  ),
  set_los AS (
    SELECT la.group_id, llo.learning_objective_id AS lo_id
    FROM lesson_assignments la
    JOIN lessons_learning_objective llo ON llo.lesson_id = la.lesson_id AND llo.active IS NOT FALSE
    UNION
    SELECT la.group_id, sc.learning_objective_id
    FROM lesson_assignments la
    JOIN lesson_success_criteria lsc ON lsc.lesson_id = la.lesson_id
    JOIN success_criteria sc ON sc.success_criteria_id = lsc.success_criteria_id
    UNION
    SELECT la.group_id, sc.learning_objective_id
    FROM lesson_assignments la
    JOIN activities a ON a.lesson_id = la.lesson_id AND a.active IS NOT FALSE
    JOIN activity_success_criteria ac ON ac.activity_id = a.activity_id
    JOIN success_criteria sc ON sc.success_criteria_id = ac.success_criteria_id
  ),
  class_unit_los AS (
    SELECT cu.group_id, cu.unit_id, ul.lo_id,
           EXISTS (SELECT 1 FROM set_los s WHERE s.group_id = cu.group_id AND s.lo_id = ul.lo_id) AS is_set
    FROM class_units cu
    JOIN unit_los ul ON ul.unit_id = cu.unit_id
    JOIN learning_objectives lo ON lo.learning_objective_id = ul.lo_id AND lo.active IS NOT FALSE
  )`

export async function getLOProgressMatrixAction() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Every class x learning objective, from pupil_criterion_scores
  // (migration 117): each pupil x activity x criterion in a started lesson set
  // to the class, rated from the latest attempt, missing = 0. Then the LOs of
  // the class's units with no scores yet, flagged by whether a lesson for them
  // has been set to the class.
  const { rows } = await query(
    `WITH ${CLASS_UNIT_LOS_SQL},
     scored AS (
     SELECT
       g.group_id,
       g.subject as group_subject,
       g.active as group_active,
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.assessment_objective_id as ao_id,
       ao.title as ao_title,
       ao.curriculum_id,
       c.title as curriculum_title,
       u.unit_id,
       u.title as unit_title,
       COUNT(DISTINCT pcs.pupil_id) as pupil_count,
       AVG(pcs.rating) as avg_rating,
       true as is_set
     FROM pupil_criterion_scores pcs
     JOIN groups g ON g.group_id = pcs.group_id
     LEFT JOIN units u ON u.unit_id = pcs.unit_id
     JOIN success_criteria sc ON sc.success_criteria_id = pcs.success_criteria_id
     JOIN learning_objectives lo ON lo.learning_objective_id = sc.learning_objective_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     LEFT JOIN curricula c ON c.curriculum_id = ao.curriculum_id
     GROUP BY g.group_id, g.subject, g.active, lo.learning_objective_id, lo.title, ao.assessment_objective_id, ao.title, ao.curriculum_id, c.title, u.unit_id, u.title
     ),
     unscored AS (
     SELECT DISTINCT ON (cul.group_id, cul.lo_id)
       g.group_id,
       g.subject as group_subject,
       g.active as group_active,
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.assessment_objective_id as ao_id,
       ao.title as ao_title,
       ao.curriculum_id,
       c.title as curriculum_title,
       u.unit_id,
       u.title as unit_title,
       0::bigint as pupil_count,
       NULL::numeric as avg_rating,
       cul.is_set
     FROM class_unit_los cul
     JOIN groups g ON g.group_id = cul.group_id
     JOIN units u ON u.unit_id = cul.unit_id
     JOIN learning_objectives lo ON lo.learning_objective_id = cul.lo_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     LEFT JOIN curricula c ON c.curriculum_id = ao.curriculum_id
     WHERE NOT EXISTS (SELECT 1 FROM scored s WHERE s.group_id = cul.group_id AND s.lo_id = cul.lo_id)
     ORDER BY cul.group_id, cul.lo_id, cul.is_set DESC, u.unit_id
     )
     SELECT * FROM (SELECT * FROM scored UNION ALL SELECT * FROM unscored) all_rows
     ORDER BY group_subject, ao_title, lo_title, group_id`,
  )

  return rows.map((row) => ({
    groupId: row.group_id as string,
    groupSubject: row.group_subject as string,
    // groups.active is nullable and defaults to true, so only an explicit
    // false counts as inactive.
    groupActive: row.group_active !== false,
    loId: row.lo_id as string,
    loTitle: row.lo_title as string,
    aoId: row.ao_id as string,
    aoTitle: row.ao_title as string,
    curriculumId: (row.curriculum_id as string) || null,
    curriculumTitle: (row.curriculum_title as string) || null,
    unitId: (row.unit_id as string) || null,
    unitTitle: (row.unit_title as string) || null,
    pupilCount: Number(row.pupil_count),
    avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
    // False: the LO is in a unit the class studies, but no lesson for it has
    // been set to the class yet.
    isSet: row.is_set as boolean,
  }))
}

export async function getClassLOMatrixAction(groupId: string) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get class info
  const { rows: classRows } = await query(
    `SELECT g.group_id, g.subject
     FROM groups g
     WHERE g.group_id = $1
     LIMIT 1`,
    [groupId]
  )

  if (classRows.length === 0) {
    throw new Error('Class not found')
  }

  const pupilIds = await resolvePupilIds(query)
  const [{ rows: pupilRows }, { rows: unscoredRows }] = await Promise.all([
    query(
      `SELECT p.user_id as pupil_id,
              COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, p.user_id) as pupil_name
       FROM group_membership gm
       JOIN profiles p ON p.user_id = gm.user_id
       WHERE gm.group_id = $1 AND gm.user_id = ANY($2::text[])`,
      [groupId, pupilIds],
    ),
    // The LOs of the class's units with no scores yet.
    query(
      `WITH ${CLASS_UNIT_LOS_SQL}
       SELECT lo.learning_objective_id as lo_id, lo.title as lo_title, ao.title as ao_title,
              bool_or(cul.is_set) as is_set, min(ao.order_index) as ao_order, min(lo.order_index) as lo_order
       FROM class_unit_los cul
       JOIN learning_objectives lo ON lo.learning_objective_id = cul.lo_id
       JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
       WHERE cul.group_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM pupil_criterion_scores pcs
           JOIN success_criteria sc ON sc.success_criteria_id = pcs.success_criteria_id
           WHERE pcs.group_id = $1 AND sc.learning_objective_id = cul.lo_id
         )
       GROUP BY lo.learning_objective_id, lo.title, ao.title
       ORDER BY ao_order, lo_order`,
      [groupId],
    ),
  ])

  // Each pupil's rating per learning objective, from pupil_criterion_scores.
  const { rows } = await query(
    `SELECT
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title,
       pcs.pupil_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, pcs.pupil_id) as pupil_name,
       AVG(pcs.rating) as avg_rating
     FROM pupil_criterion_scores pcs
     JOIN success_criteria sc ON sc.success_criteria_id = pcs.success_criteria_id
     JOIN learning_objectives lo ON lo.learning_objective_id = sc.learning_objective_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     JOIN profiles p ON p.user_id = pcs.pupil_id
     WHERE pcs.group_id = $1
     GROUP BY lo.learning_objective_id, lo.title, ao.title, ao.order_index, lo.order_index, pcs.pupil_id, p.first_name, p.last_name
     ORDER BY ao.order_index, lo.order_index, p.first_name, p.last_name`,
    [groupId]
  )

  return {
    groupId: classRows[0].group_id as string,
    groupSubject: classRows[0].subject as string,
    data: rows.map((row) => ({
      loId: row.lo_id as string,
      loTitle: row.lo_title as string,
      aoTitle: row.ao_title as string,
      pupilId: row.pupil_id as string,
      pupilName: row.pupil_name as string,
      avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
    })),
    pupils: pupilRows.map((row) => ({ pupilId: row.pupil_id as string, pupilName: row.pupil_name as string })),
    // In the class's units but unscored. isSet false: no lesson for it has
    // been set to the class yet.
    unscoredLos: unscoredRows.map((row) => ({
      loId: row.lo_id as string,
      loTitle: row.lo_title as string,
      aoTitle: row.ao_title as string,
      isSet: row.is_set as boolean,
    })),
  }
}

export async function getPupilLOSuccessCriteriaAction(groupId: string, loId: string, pupilId: string) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Every criterion of the objective, with the pupil's rating from
  // pupil_criterion_scores: the mean over the activities set to the class that
  // carry it, missing = 0. A criterion no started activity carries has none.
  const { rows } = await query(
    `SELECT
       p.user_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, p.user_id) as pupil_name,
       g.group_id,
       g.subject as group_subject,
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title,
       sc.success_criteria_id,
       sc.description as sc_title,
       (SELECT AVG(pcs.rating) FROM pupil_criterion_scores pcs
         WHERE pcs.group_id = g.group_id AND pcs.pupil_id = p.user_id
           AND pcs.success_criteria_id = sc.success_criteria_id) as latest_rating
     FROM profiles p
     CROSS JOIN groups g
     CROSS JOIN learning_objectives lo
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     LEFT JOIN success_criteria sc ON sc.learning_objective_id = lo.learning_objective_id
     WHERE p.user_id = $1 AND g.group_id = $2 AND lo.learning_objective_id = $3
     ORDER BY sc.order_index`,
    [pupilId, groupId, loId]
  )

  if (rows.length === 0) {
    throw new Error('Pupil, class, or learning objective not found')
  }

  const firstRow = rows[0]

  return {
    groupId: firstRow.group_id as string,
    groupSubject: firstRow.group_subject as string,
    loId: firstRow.lo_id as string,
    loTitle: firstRow.lo_title as string,
    aoTitle: firstRow.ao_title as string,
    pupilId: firstRow.user_id as string,
    pupilName: firstRow.pupil_name as string,
    successCriteria: rows
      .filter(row => row.success_criteria_id != null)
      .map((row) => ({
        scId: row.success_criteria_id as string,
        scTitle: row.sc_title as string,
        rating: row.latest_rating != null ? Number(row.latest_rating) : null,
      }))
  }
}

export async function getClassLOSCMatrixAction(groupId: string, loId: string) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get class and LO info
  const { rows: metaRows } = await query(
    `SELECT
       g.group_id,
       g.subject as group_subject,
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title
     FROM groups g
     CROSS JOIN learning_objectives lo
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     WHERE g.group_id = $1 AND lo.learning_objective_id = $2
     LIMIT 1`,
    [groupId, loId]
  )

  if (metaRows.length === 0) {
    throw new Error('Class or learning objective not found')
  }

  // Each pupil x criterion of the objective, from pupil_criterion_scores.
  // A criterion no started activity carries is listed with no rating.
  const { rows } = await query(
    `SELECT
       sc.success_criteria_id as sc_id,
       sc.description as sc_title,
       sc.order_index as sc_order,
       gm.user_id as pupil_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, gm.user_id) as pupil_name,
       AVG(pcs.rating) as rating
     FROM success_criteria sc
     JOIN group_membership gm ON gm.group_id = $1 AND gm.user_id = ANY($3::text[])
     JOIN profiles p ON p.user_id = gm.user_id
     LEFT JOIN pupil_criterion_scores pcs
       ON pcs.group_id = gm.group_id AND pcs.pupil_id = gm.user_id
      AND pcs.success_criteria_id = sc.success_criteria_id
     WHERE sc.learning_objective_id = $2
     GROUP BY sc.success_criteria_id, sc.description, sc.order_index, gm.user_id, p.first_name, p.last_name
     ORDER BY sc.order_index, p.first_name, p.last_name`,
    [groupId, loId, await resolvePupilIds(query)]
  )

  const meta = metaRows[0]

  return {
    groupId: meta.group_id as string,
    groupSubject: meta.group_subject as string,
    loId: meta.lo_id as string,
    loTitle: meta.lo_title as string,
    aoTitle: meta.ao_title as string,
    data: rows.map((row) => ({
      scId: row.sc_id as string,
      scTitle: row.sc_title as string,
      scOrder: Number(row.sc_order),
      pupilId: row.pupil_id as string,
      pupilName: row.pupil_name as string,
      rating: row.rating != null ? Number(row.rating) : null,
    }))
  }
}
