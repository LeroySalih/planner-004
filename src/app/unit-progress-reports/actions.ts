'use server'

import { query } from '@/lib/db'
import { requireAuthenticatedProfile } from '@/lib/auth'

export async function getClassProgressAction(groupId: string, summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get units assigned to this group with average metrics across all pupils
  // Aggregated from submission-level scores (not individual feedback records)
  const { rows: unitRows } = await query(
    `SELECT
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       COUNT(DISTINCT gm.user_id) as pupil_count,
       AVG(CASE WHEN $2 = true AND a.is_summative = false THEN NULL
                ELSE COALESCE((s.body->>'teacher_override_score')::numeric, 0) END) as avg_score
     FROM lesson_assignments la
     JOIN lessons l ON l.lesson_id = la.lesson_id
     JOIN units u ON u.unit_id = l.unit_id
     JOIN activities a ON a.lesson_id = l.lesson_id
     JOIN group_membership gm ON gm.group_id = la.group_id
     LEFT JOIN submissions s ON s.activity_id = a.activity_id
                             AND s.user_id = gm.user_id
     WHERE la.group_id = $1
     GROUP BY u.unit_id, u.title, u.subject
     ORDER BY u.title`,
    [groupId, summativeOnly]
  )

  return unitRows.map((row) => ({
    unitId: row.unit_id as string,
    unitTitle: row.unit_title as string,
    unitSubject: row.unit_subject as string | null,
    pupilCount: Number(row.pupil_count),
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
  }))
}

export async function getProgressMatrixAction(summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get all units, classes, and their metrics across all classes
  // Aggregated from submission-level scores (not individual feedback records)
  const { rows } = await query(
    `SELECT
       g.group_id,
       g.subject as group_subject,
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       COUNT(DISTINCT gm.user_id) as pupil_count,
       AVG(CASE WHEN $1 = true AND a.is_summative = false THEN NULL
                ELSE COALESCE((s.body->>'teacher_override_score')::numeric, 0) END) as avg_score
     FROM groups g
     JOIN lesson_assignments la ON la.group_id = g.group_id
     JOIN lessons l ON l.lesson_id = la.lesson_id
     JOIN units u ON u.unit_id = l.unit_id
     JOIN activities a ON a.lesson_id = l.lesson_id
     JOIN group_membership gm ON gm.group_id = g.group_id
     LEFT JOIN submissions s ON s.activity_id = a.activity_id
                             AND s.user_id = gm.user_id
     GROUP BY g.group_id, g.subject, u.unit_id, u.title, u.subject
     ORDER BY g.subject, u.title, g.group_id`,
    [summativeOnly]
  )

  return rows.map((row) => ({
    groupId: row.group_id as string,
    groupSubject: row.group_subject as string,
    unitId: row.unit_id as string,
    unitTitle: row.unit_title as string,
    unitSubject: row.unit_subject as string | null,
    pupilCount: Number(row.pupil_count),
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
  }))
}

export async function getClassPupilMatrixAction(groupId: string, summativeOnly = false) {
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

  // Get all units assigned to this class with metrics for each pupil
  // Aggregated from submission-level scores (not individual feedback records)
  const { rows } = await query(
    `SELECT
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       gm.user_id as pupil_id,
       p.first_name,
       p.last_name,
       AVG(CASE WHEN $2 = true AND a.is_summative = false THEN NULL
                ELSE COALESCE((s.body->>'teacher_override_score')::numeric, 0) END) as avg_score
     FROM lesson_assignments la
     JOIN lessons l ON l.lesson_id = la.lesson_id
     JOIN units u ON u.unit_id = l.unit_id
     JOIN activities a ON a.lesson_id = l.lesson_id
     JOIN group_membership gm ON gm.group_id = la.group_id
     JOIN profiles p ON p.user_id = gm.user_id
     LEFT JOIN submissions s ON s.activity_id = a.activity_id
                             AND s.user_id = gm.user_id
     WHERE la.group_id = $1
     GROUP BY u.unit_id, u.title, u.subject, gm.user_id, p.first_name, p.last_name
     ORDER BY p.last_name, p.first_name, u.title`,
    [groupId, summativeOnly]
  )

  return {
    groupId: classRows[0].group_id as string,
    groupSubject: classRows[0].subject as string,
    data: rows.map((row) => ({
      unitId: row.unit_id as string,
      unitTitle: row.unit_title as string,
      unitSubject: row.unit_subject as string | null,
      pupilId: row.pupil_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    }))
  }
}

export async function getUnitLessonMatrixAction(groupId: string, unitId: string, summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get class and unit info
  const { rows: infoRows } = await query(
    `SELECT g.group_id, g.subject, u.unit_id, u.title as unit_title
     FROM groups g
     CROSS JOIN units u
     WHERE g.group_id = $1 AND u.unit_id = $2
     LIMIT 1`,
    [groupId, unitId]
  )

  if (infoRows.length === 0) {
    throw new Error('Class or unit not found')
  }

  // Get lesson-level metrics by aggregating submission-level scores
  const { rows } = await query(
    `WITH lesson_activity_scores AS (
       SELECT
         l.lesson_id,
         l.title as lesson_title,
         l.order_by,
         gm.user_id as pupil_id,
         p.first_name,
         p.last_name,
         a.activity_id,
         a.is_summative,
         COALESCE((s.body->>'teacher_override_score')::numeric, 0) as score
       FROM lessons l
       JOIN lesson_assignments la ON la.lesson_id = l.lesson_id AND la.group_id = $1
       JOIN group_membership gm ON gm.group_id = la.group_id
       JOIN profiles p ON p.user_id = gm.user_id
       LEFT JOIN activities a ON a.lesson_id = l.lesson_id
       LEFT JOIN submissions s ON s.activity_id = a.activity_id AND s.user_id = gm.user_id
       WHERE l.unit_id = $2
     )
     SELECT
       lesson_id,
       lesson_title,
       order_by,
       pupil_id,
       first_name,
       last_name,
       AVG(CASE WHEN $3 = true AND is_summative = false THEN NULL ELSE score END) as avg_score
     FROM lesson_activity_scores
     GROUP BY lesson_id, lesson_title, order_by, pupil_id, first_name, last_name
     ORDER BY order_by, last_name, first_name`,
    [groupId, unitId, summativeOnly]
  )

  return {
    groupId: infoRows[0].group_id as string,
    groupSubject: infoRows[0].subject as string,
    unitId: infoRows[0].unit_id as string,
    unitTitle: infoRows[0].unit_title as string,
    data: rows.map((row) => ({
      lessonId: row.lesson_id as string,
      lessonTitle: row.lesson_title as string,
      pupilId: row.pupil_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    }))
  }
}

export async function getPupilUnitLessonsAction(groupId: string, unitId: string, pupilId: string, summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get pupil info and context
  const { rows: infoRows } = await query(
    `SELECT
       p.user_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, p.user_id) as pupil_name,
       g.group_id,
       g.subject as group_subject,
       u.unit_id,
       u.title as unit_title
     FROM profiles p
     CROSS JOIN groups g
     CROSS JOIN units u
     WHERE p.user_id = $1 AND g.group_id = $2 AND u.unit_id = $3
     LIMIT 1`,
    [pupilId, groupId, unitId]
  )

  if (infoRows.length === 0) {
    throw new Error('Pupil, class, or unit not found')
  }

  // Get lesson-level averages by aggregating from submission-level scores
  const { rows: lessonRows } = await query(
    `SELECT
       l.lesson_id,
       l.title as lesson_title,
       l.order_by,
       AVG(CASE WHEN $4 = true AND a.is_summative = false THEN NULL
                ELSE COALESCE((s.body->>'teacher_override_score')::numeric, 0) END) as avg_score
     FROM lessons l
     JOIN lesson_assignments la ON la.lesson_id = l.lesson_id AND la.group_id = $1
     LEFT JOIN activities a ON a.lesson_id = l.lesson_id
     LEFT JOIN submissions s ON s.activity_id = a.activity_id
                             AND s.user_id = $2
     WHERE l.unit_id = $3
     GROUP BY l.lesson_id, l.title, l.order_by
     ORDER BY l.order_by`,
    [groupId, pupilId, unitId, summativeOnly]
  )

  const infoRow = infoRows[0]

  return {
    groupId: infoRow.group_id as string,
    groupSubject: infoRow.group_subject as string,
    unitId: infoRow.unit_id as string,
    unitTitle: infoRow.unit_title as string,
    pupilId: infoRow.user_id as string,
    pupilName: infoRow.pupil_name as string,
    lessons: lessonRows.map((row) => ({
      lessonId: row.lesson_id as string,
      lessonTitle: row.lesson_title as string,
      avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    }))
  }
}

export async function getPupilUnitLOSCAction(groupId: string, unitId: string, pupilId: string) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get pupil info and context
  const { rows: infoRows } = await query(
    `SELECT
       p.user_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, p.user_id) as pupil_name,
       g.group_id,
       g.subject as group_subject,
       u.unit_id,
       u.title as unit_title
     FROM profiles p
     CROSS JOIN groups g
     CROSS JOIN units u
     WHERE p.user_id = $1 AND g.group_id = $2 AND u.unit_id = $3
     LIMIT 1`,
    [pupilId, groupId, unitId]
  )

  if (infoRows.length === 0) {
    throw new Error('Pupil, class, or unit not found')
  }

  // Get LOs linked to lessons in this unit, their SCs, and the pupil's latest SC scores
  const { rows } = await query(
    `WITH latest_feedback AS (
       SELECT DISTINCT ON (s.user_id, sc_kv.key)
         s.user_id,
         sc_kv.key as success_criteria_id,
         (sc_kv.value)::numeric as rating
       FROM submissions s
       CROSS JOIN LATERAL json_each_text(s.body->'success_criteria_scores') as sc_kv
       WHERE s.body->'success_criteria_scores' IS NOT NULL
         AND s.user_id = $3
       ORDER BY s.user_id, sc_kv.key, s.submitted_at DESC
     )
     SELECT DISTINCT
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title,
       ao.order_index as ao_order,
       lo.order_index as lo_order,
       sc.success_criteria_id as sc_id,
       sc.description as sc_description,
       sc.order_index as sc_order,
       lf.rating
     FROM lessons l
     JOIN lesson_assignments la ON la.lesson_id = l.lesson_id AND la.group_id = $1
     JOIN lessons_learning_objective llo ON llo.lesson_id = l.lesson_id
     JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     LEFT JOIN success_criteria sc ON sc.learning_objective_id = lo.learning_objective_id
     LEFT JOIN latest_feedback lf ON lf.success_criteria_id = sc.success_criteria_id
     WHERE l.unit_id = $2
     ORDER BY ao.order_index, lo.order_index, sc.order_index`,
    [groupId, unitId, pupilId]
  )

  const infoRow = infoRows[0]

  return {
    groupId: infoRow.group_id as string,
    groupSubject: infoRow.group_subject as string,
    unitId: infoRow.unit_id as string,
    unitTitle: infoRow.unit_title as string,
    pupilId: infoRow.user_id as string,
    pupilName: infoRow.pupil_name as string,
    data: rows.map((row) => ({
      loId: row.lo_id as string,
      loTitle: row.lo_title as string,
      aoTitle: row.ao_title as string,
      scId: row.sc_id as string | null,
      scDescription: row.sc_description as string | null,
      rating: row.rating != null ? Number(row.rating) : null,
    }))
  }
}
