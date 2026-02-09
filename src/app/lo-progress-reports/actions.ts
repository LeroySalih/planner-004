'use server'

import { query } from '@/lib/db'
import { requireAuthenticatedProfile } from '@/lib/auth'

export async function getLOProgressMatrixAction() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get all learning objectives, classes, and their metrics for classes the teacher is associated with
  // Using latest feedback ratings directly from feedback table
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (user_id, success_criteria_id)
         user_id,
         success_criteria_id,
         rating
       FROM feedback
       ORDER BY user_id, success_criteria_id, id DESC
     )
     SELECT
       g.group_id,
       g.subject as group_subject,
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title,
       COUNT(DISTINCT gm.user_id) as pupil_count,
       AVG(lf.rating) as avg_rating
     FROM groups g
     JOIN group_membership gm_teacher ON g.group_id = gm_teacher.group_id AND gm_teacher.user_id = $1
     JOIN lesson_assignments la ON la.group_id = g.group_id
     JOIN lessons_learning_objective llo ON llo.lesson_id = la.lesson_id
     JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     JOIN success_criteria sc ON sc.learning_objective_id = lo.learning_objective_id
     JOIN group_membership gm ON gm.group_id = g.group_id
     LEFT JOIN latest_feedback lf ON lf.success_criteria_id = sc.success_criteria_id
                                  AND lf.user_id = gm.user_id
     GROUP BY g.group_id, g.subject, lo.learning_objective_id, lo.title, ao.title
     ORDER BY g.subject, ao.title, lo.title, g.group_id`,
    [profile.userId]
  )

  return rows.map((row) => ({
    groupId: row.group_id as string,
    groupSubject: row.group_subject as string,
    loId: row.lo_id as string,
    loTitle: row.lo_title as string,
    aoTitle: row.ao_title as string,
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
     JOIN group_membership gm ON g.group_id = gm.group_id
     WHERE g.group_id = $1 AND gm.user_id = $2
     LIMIT 1`,
    [groupId, profile.userId]
  )

  if (classRows.length === 0) {
    throw new Error('Class not found or access denied')
  }

  // Get all learning objectives assigned to this class with metrics for each pupil
  // Using latest feedback ratings directly from feedback table
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (user_id, success_criteria_id)
         user_id,
         success_criteria_id,
         rating
       FROM feedback
       ORDER BY user_id, success_criteria_id, id DESC
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

  // Verify teacher has access to this class
  const { rows: accessRows } = await query(
    `SELECT 1 FROM group_membership WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
    [groupId, profile.userId]
  )

  if (accessRows.length === 0) {
    throw new Error('Access denied')
  }

  // Get pupil info, LO info, and success criteria with latest ratings
  // Using latest feedback directly from feedback table
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (user_id, success_criteria_id)
         user_id,
         success_criteria_id,
         rating
       FROM feedback
       WHERE user_id = $1
       ORDER BY user_id, success_criteria_id, id DESC
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
       sc.title as sc_title,
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
