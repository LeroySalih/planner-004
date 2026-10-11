'use server'

import { query } from '@/lib/db'
import { requireAuthenticatedProfile } from '@/lib/auth'
import { resolvePupilIds } from "@/lib/roles/pupil-membership"

/**
 * Progress for every class, in one server action and one query.
 *
 * Scores come from pupil_activity_scores (migration 117), the common baseline:
 * every scorable activity in a started lesson set to the class, latest
 * attempt, missing work = 0, averaged as total marks over total available.
 * The old per-class queries had to run one group at a time to stay fast; the
 * view aggregates every class at once in well under a second.
 */
export async function getAllClassesProgressAction(summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  const { rows: groupRows } = await query(
    `SELECT DISTINCT group_id FROM lesson_assignments ORDER BY group_id`,
  )
  const byGroup: Record<string, Awaited<ReturnType<typeof loadClassProgress>>> = Object.fromEntries(
    groupRows.map((row) => [row.group_id as string, []]),
  )
  for (const row of await loadClassProgress(null, summativeOnly)) {
    byGroup[row.groupId] = [...(byGroup[row.groupId] ?? []), row]
  }
  return byGroup
}

/**
 * Unit progress per class from the baseline view. No auth of its own: callers
 * have already checked. `groupId` null loads every class.
 */
async function loadClassProgress(groupId: string | null, summativeOnly = false) {
  const { rows: unitRows } = await query(
    `SELECT
       pas.group_id,
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       COUNT(DISTINCT pas.pupil_id) as pupil_count,
       (SUM(pas.marks) FILTER (WHERE NOT $2 OR pas.is_summative)::numeric
         / NULLIF(SUM(pas.max_marks) FILTER (WHERE NOT $2 OR pas.is_summative), 0)) * 100 as avg_score
     FROM pupil_activity_scores pas
     JOIN units u ON u.unit_id = pas.unit_id
     WHERE $1::text IS NULL OR pas.group_id = $1
     GROUP BY pas.group_id, u.unit_id, u.title, u.subject
     ORDER BY u.title`,
    [groupId, summativeOnly],
  )

  return unitRows.map((row) => ({
    groupId: row.group_id as string,
    unitId: row.unit_id as string,
    unitTitle: row.unit_title as string,
    unitSubject: row.unit_subject as string | null,
    pupilCount: Number(row.pupil_count),
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
  }))
}

export async function getClassProgressAction(groupId: string, summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  return loadClassProgress(groupId, summativeOnly)
}

export async function getProgressMatrixAction(summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Every unit x class, from the baseline view (see getAllClassesProgressAction).
  const { rows } = await query(
    `SELECT
       g.group_id,
       g.subject as group_subject,
       g.active as group_active,
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       u.curriculum_id,
       cur.title as curriculum_title,
       COUNT(DISTINCT pas.pupil_id) as pupil_count,
       (SUM(pas.marks) FILTER (WHERE NOT $1 OR pas.is_summative)::numeric
         / NULLIF(SUM(pas.max_marks) FILTER (WHERE NOT $1 OR pas.is_summative), 0)) * 100 as avg_score
     FROM pupil_activity_scores pas
     JOIN groups g ON g.group_id = pas.group_id
     JOIN units u ON u.unit_id = pas.unit_id
     LEFT JOIN curricula cur ON cur.curriculum_id = u.curriculum_id
     GROUP BY g.group_id, g.subject, g.active, u.unit_id, u.title, u.subject, u.curriculum_id, cur.title
     ORDER BY g.subject, u.title, g.group_id`,
    [summativeOnly]
  )

  return rows.map((row) => ({
    groupId: row.group_id as string,
    groupSubject: row.group_subject as string,
    // groups.active is nullable and defaults to true, so only an explicit
    // false counts as inactive.
    groupActive: row.group_active !== false,
    unitId: row.unit_id as string,
    unitTitle: row.unit_title as string,
    unitSubject: row.unit_subject as string | null,
    curriculumId: (row.curriculum_id as string) || null,
    curriculumTitle: (row.curriculum_title as string) || null,
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

  // Each pupil's score per unit, from the baseline view.
  const { rows } = await query(
    `SELECT
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       pas.pupil_id,
       p.first_name,
       p.last_name,
       (SUM(pas.marks) FILTER (WHERE NOT $2 OR pas.is_summative)::numeric
         / NULLIF(SUM(pas.max_marks) FILTER (WHERE NOT $2 OR pas.is_summative), 0)) * 100 as avg_score,
       SUM(pas.marks) FILTER (WHERE NOT $2 OR pas.is_summative) as marks,
       SUM(pas.max_marks) FILTER (WHERE NOT $2 OR pas.is_summative) as max_marks
     FROM pupil_activity_scores pas
     JOIN units u ON u.unit_id = pas.unit_id
     JOIN profiles p ON p.user_id = pas.pupil_id
     WHERE pas.group_id = $1
     GROUP BY u.unit_id, u.title, u.subject, pas.pupil_id, p.first_name, p.last_name
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
      // For weighted roll-ups across units or lessons: total marks over total available.
      marks: row.marks != null ? Number(row.marks) : 0,
      maxMarks: row.max_marks != null ? Number(row.max_marks) : 0,
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

  // Every lesson of the unit set to the class x every pupil, scored from the
  // baseline view. Lessons not started yet, or with nothing to score, are
  // still listed, with no score.
  const { rows } = await query(
    `SELECT
       l.lesson_id,
       l.title as lesson_title,
       l.order_by,
       gm.user_id as pupil_id,
       p.first_name,
       p.last_name,
       (SUM(pas.marks) FILTER (WHERE NOT $3 OR pas.is_summative)::numeric
         / NULLIF(SUM(pas.max_marks) FILTER (WHERE NOT $3 OR pas.is_summative), 0)) * 100 as avg_score,
       SUM(pas.marks) FILTER (WHERE NOT $3 OR pas.is_summative) as marks,
       SUM(pas.max_marks) FILTER (WHERE NOT $3 OR pas.is_summative) as max_marks
     FROM lessons l
     JOIN lesson_assignments la ON la.lesson_id = l.lesson_id AND la.group_id = $1
     JOIN group_membership gm ON gm.group_id = la.group_id AND gm.user_id = ANY($4::text[])
     JOIN profiles p ON p.user_id = gm.user_id
     LEFT JOIN pupil_activity_scores pas
       ON pas.group_id = la.group_id AND pas.lesson_id = l.lesson_id AND pas.pupil_id = gm.user_id
     WHERE l.unit_id = $2
       AND coalesce(l.active, true) = true
     GROUP BY l.lesson_id, l.title, l.order_by, gm.user_id, p.first_name, p.last_name
     ORDER BY l.order_by, p.last_name, p.first_name`,
    [groupId, unitId, summativeOnly, await resolvePupilIds(query)]
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
      // For weighted roll-ups across units or lessons: total marks over total available.
      marks: row.marks != null ? Number(row.marks) : 0,
      maxMarks: row.max_marks != null ? Number(row.max_marks) : 0,
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

  // The pupil's score per lesson of the unit set to the class, from the
  // baseline view. Unstarted or unscored lessons are listed with no score.
  const { rows: lessonRows } = await query(
    `SELECT
       l.lesson_id,
       l.title as lesson_title,
       l.order_by,
       (SUM(pas.marks) FILTER (WHERE NOT $4 OR pas.is_summative)::numeric
         / NULLIF(SUM(pas.max_marks) FILTER (WHERE NOT $4 OR pas.is_summative), 0)) * 100 as avg_score
     FROM lessons l
     JOIN lesson_assignments la ON la.lesson_id = l.lesson_id AND la.group_id = $1
     LEFT JOIN pupil_activity_scores pas
       ON pas.group_id = la.group_id AND pas.lesson_id = l.lesson_id AND pas.pupil_id = $2
     WHERE l.unit_id = $3
       AND coalesce(l.active, true) = true
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
    // Ratings from pupil_criterion_scores (migration 117), limited to this
    // unit's activities: latest attempt, missing = 0, mean over the
    // activities carrying the criterion. Uncarried criteria have no rating.
    `SELECT DISTINCT
       lo.learning_objective_id as lo_id,
       lo.title as lo_title,
       ao.title as ao_title,
       ao.order_index as ao_order,
       lo.order_index as lo_order,
       sc.success_criteria_id as sc_id,
       sc.description as sc_description,
       sc.order_index as sc_order,
       (SELECT AVG(pcs.rating) FROM pupil_criterion_scores pcs
         WHERE pcs.group_id = $1 AND pcs.unit_id = $2 AND pcs.pupil_id = $3
           AND pcs.success_criteria_id = sc.success_criteria_id) as rating
     FROM lessons l
     JOIN lesson_assignments la ON la.lesson_id = l.lesson_id AND la.group_id = $1
     JOIN lessons_learning_objective llo ON llo.lesson_id = l.lesson_id
     JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
     JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
     LEFT JOIN success_criteria sc ON sc.learning_objective_id = lo.learning_objective_id
     WHERE l.unit_id = $2
       AND coalesce(l.active, true) = true
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
