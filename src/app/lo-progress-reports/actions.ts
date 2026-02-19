'use server'

import { query } from '@/lib/db'
import { requireAuthenticatedProfile } from '@/lib/auth'

export async function getLOProgressMatrixAction() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get all learning objectives, classes, and their metrics across all classes
  // Using per-SC scores from submissions body
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (s.user_id, sc_kv.key)
         s.user_id,
         sc_kv.key as success_criteria_id,
         (sc_kv.value)::numeric as rating
       FROM submissions s
       CROSS JOIN LATERAL json_each_text(s.body->'success_criteria_scores') as sc_kv
       WHERE s.body->'success_criteria_scores' IS NOT NULL
       ORDER BY s.user_id, sc_kv.key, s.submitted_at DESC
     )
     SELECT
       g.group_id,
       g.subject as group_subject,
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.assessment_objective_id as ao_id,
       ao.title as ao_title,
       ao.curriculum_id,
       c.title as curriculum_title,
       u.unit_id,
       u.title as unit_title,
       COUNT(DISTINCT gm.user_id) as pupil_count,
       AVG(lf.rating) as avg_rating
     FROM groups g
     JOIN lesson_assignments la ON la.group_id = g.group_id
     JOIN lessons l ON l.lesson_id = la.lesson_id
     LEFT JOIN units u ON u.unit_id = l.unit_id
     JOIN lessons_learning_objective llo ON llo.lesson_id = la.lesson_id
     JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     LEFT JOIN curricula c ON c.curriculum_id = ao.curriculum_id
     JOIN success_criteria sc ON sc.learning_objective_id = lo.learning_objective_id
     JOIN group_membership gm ON gm.group_id = g.group_id
     LEFT JOIN latest_feedback lf ON lf.success_criteria_id = sc.success_criteria_id
                                  AND lf.user_id = gm.user_id
     GROUP BY g.group_id, g.subject, lo.learning_objective_id, lo.title, ao.assessment_objective_id, ao.title, ao.curriculum_id, c.title, u.unit_id, u.title
     ORDER BY g.subject, ao.title, lo.title, g.group_id`
  )

  return rows.map((row) => ({
    groupId: row.group_id as string,
    groupSubject: row.group_subject as string,
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

  // Get all learning objectives assigned to this class with metrics for each pupil
  // Using per-SC scores from submissions body
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (s.user_id, sc_kv.key)
         s.user_id,
         sc_kv.key as success_criteria_id,
         (sc_kv.value)::numeric as rating
       FROM submissions s
       CROSS JOIN LATERAL json_each_text(s.body->'success_criteria_scores') as sc_kv
       WHERE s.body->'success_criteria_scores' IS NOT NULL
       ORDER BY s.user_id, sc_kv.key, s.submitted_at DESC
     )
     SELECT
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title,
       gm.user_id as pupil_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, gm.user_id) as pupil_name,
       AVG(lf.rating) as avg_rating
     FROM lesson_assignments la
     JOIN lessons_learning_objective llo ON llo.lesson_id = la.lesson_id
     JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     JOIN success_criteria sc ON sc.learning_objective_id = lo.learning_objective_id
     JOIN group_membership gm ON gm.group_id = la.group_id
     JOIN profiles p ON p.user_id = gm.user_id
     LEFT JOIN latest_feedback lf ON lf.success_criteria_id = sc.success_criteria_id
                                  AND lf.user_id = gm.user_id
     WHERE la.group_id = $1
     GROUP BY lo.learning_objective_id, lo.title, ao.title, ao.order_index, lo.order_index, gm.user_id, p.first_name, p.last_name
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
    }))
  }
}

export async function getPupilLOSuccessCriteriaAction(groupId: string, loId: string, pupilId: string) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get pupil info, LO info, and success criteria with latest ratings
  // Using per-SC scores from submissions body
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (s.user_id, sc_kv.key)
         s.user_id,
         sc_kv.key as success_criteria_id,
         (sc_kv.value)::numeric as rating
       FROM submissions s
       CROSS JOIN LATERAL json_each_text(s.body->'success_criteria_scores') as sc_kv
       WHERE s.body->'success_criteria_scores' IS NOT NULL
         AND s.user_id = $1
       ORDER BY s.user_id, sc_kv.key, s.submitted_at DESC
     )
     SELECT
       p.user_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, p.user_id) as pupil_name,
       g.group_id,
       g.subject as group_subject,
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title,
       sc.success_criteria_id,
       sc.description as sc_title,
       lf.rating as latest_rating
     FROM profiles p
     CROSS JOIN groups g
     CROSS JOIN learning_objectives lo
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     LEFT JOIN success_criteria sc ON sc.learning_objective_id = lo.learning_objective_id
     LEFT JOIN latest_feedback lf ON lf.success_criteria_id = sc.success_criteria_id
                                  AND lf.user_id = p.user_id
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

  // Get per-pupil, per-SC scores
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (s.user_id, sc_kv.key)
         s.user_id,
         sc_kv.key as success_criteria_id,
         (sc_kv.value)::numeric as rating
       FROM submissions s
       CROSS JOIN LATERAL json_each_text(s.body->'success_criteria_scores') as sc_kv
       WHERE s.body->'success_criteria_scores' IS NOT NULL
       ORDER BY s.user_id, sc_kv.key, s.submitted_at DESC
     )
     SELECT
       sc.success_criteria_id as sc_id,
       sc.description as sc_title,
       sc.order_index as sc_order,
       gm.user_id as pupil_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, gm.user_id) as pupil_name,
       lf.rating
     FROM success_criteria sc
     JOIN group_membership gm ON gm.group_id = $1
     JOIN profiles p ON p.user_id = gm.user_id
     LEFT JOIN latest_feedback lf ON lf.success_criteria_id = sc.success_criteria_id
                                  AND lf.user_id = gm.user_id
     WHERE sc.learning_objective_id = $2
     ORDER BY sc.order_index, p.first_name, p.last_name`,
    [groupId, loId]
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
