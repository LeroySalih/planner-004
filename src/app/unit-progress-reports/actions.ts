'use server'

import { query } from '@/lib/db'
import { requireAuthenticatedProfile } from '@/lib/auth'

export async function getClassProgressAction(groupId: string) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get all pupils in this group
  const { rows: memberRows } = await query(
    `SELECT DISTINCT user_id
     FROM group_membership
     WHERE group_id = $1`,
    [groupId]
  )

  const pupilIds = memberRows.map((row) => row.user_id as string)

  if (pupilIds.length === 0) {
    return []
  }

  // Get units assigned to this group with average metrics across all pupils
  const { rows: unitRows } = await query(
    `SELECT
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       COUNT(DISTINCT gm.user_id) as pupil_count,
       AVG(rus.activities_average) as avg_completion,
       AVG(rus.assessment_average) as avg_assessment
     FROM lesson_assignments la
     JOIN lessons l ON l.lesson_id = la.lesson_id
     JOIN units u ON u.unit_id = l.unit_id
     JOIN group_membership gm ON gm.group_id = la.group_id
     LEFT JOIN report_pupil_unit_summaries rus ON rus.unit_id = u.unit_id AND rus.pupil_id = gm.user_id
     WHERE la.group_id = $1
     GROUP BY u.unit_id, u.title, u.subject
     ORDER BY u.title`,
    [groupId]
  )

  return unitRows.map((row) => ({
    unitId: row.unit_id as string,
    unitTitle: row.unit_title as string,
    unitSubject: row.unit_subject as string | null,
    pupilCount: Number(row.pupil_count),
    avgCompletion: row.avg_completion != null ? Number(row.avg_completion) : null,
    avgAssessment: row.avg_assessment != null ? Number(row.avg_assessment) : null,
  }))
}

export async function getProgressMatrixAction() {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get all units, classes, and their metrics for classes the teacher is associated with
  const { rows } = await query(
    `SELECT
       g.group_id,
       g.subject as group_subject,
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       COUNT(DISTINCT gm.user_id) as pupil_count,
       AVG(rus.activities_average) as avg_completion,
       AVG(rus.assessment_average) as avg_assessment
     FROM groups g
     JOIN group_membership gm_teacher ON g.group_id = gm_teacher.group_id AND gm_teacher.user_id = $1
     JOIN lesson_assignments la ON la.group_id = g.group_id
     JOIN lessons l ON l.lesson_id = la.lesson_id
     JOIN units u ON u.unit_id = l.unit_id
     JOIN group_membership gm ON gm.group_id = g.group_id
     LEFT JOIN report_pupil_unit_summaries rus ON rus.unit_id = u.unit_id AND rus.pupil_id = gm.user_id
     GROUP BY g.group_id, g.subject, u.unit_id, u.title, u.subject
     ORDER BY g.subject, u.title, g.group_id`,
    [profile.userId]
  )

  return rows.map((row) => ({
    groupId: row.group_id as string,
    groupSubject: row.group_subject as string,
    unitId: row.unit_id as string,
    unitTitle: row.unit_title as string,
    unitSubject: row.unit_subject as string | null,
    pupilCount: Number(row.pupil_count),
    avgCompletion: row.avg_completion != null ? Number(row.avg_completion) : null,
    avgAssessment: row.avg_assessment != null ? Number(row.avg_assessment) : null,
  }))
}

export async function getClassPupilMatrixAction(groupId: string) {
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

  // Get all units assigned to this class with metrics for each pupil
  const { rows } = await query(
    `SELECT
       u.unit_id,
       u.title as unit_title,
       u.subject as unit_subject,
       gm.user_id as pupil_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, gm.user_id) as pupil_name,
       rus.activities_average as avg_completion,
       rus.assessment_average as avg_assessment
     FROM lesson_assignments la
     JOIN lessons l ON l.lesson_id = la.lesson_id
     JOIN units u ON u.unit_id = l.unit_id
     JOIN group_membership gm ON gm.group_id = la.group_id
     JOIN profiles p ON p.user_id = gm.user_id
     LEFT JOIN report_pupil_unit_summaries rus ON rus.unit_id = u.unit_id AND rus.pupil_id = gm.user_id
     WHERE la.group_id = $1
     GROUP BY u.unit_id, u.title, u.subject, gm.user_id, p.first_name, p.last_name, rus.activities_average, rus.assessment_average
     ORDER BY u.title, p.first_name, p.last_name`,
    [groupId]
  )

  return {
    groupId: classRows[0].group_id as string,
    groupSubject: classRows[0].subject as string,
    data: rows.map((row) => ({
      unitId: row.unit_id as string,
      unitTitle: row.unit_title as string,
      unitSubject: row.unit_subject as string | null,
      pupilId: row.pupil_id as string,
      pupilName: row.pupil_name as string,
      avgCompletion: row.avg_completion != null ? Number(row.avg_completion) : null,
      avgAssessment: row.avg_assessment != null ? Number(row.avg_assessment) : null,
    }))
  }
}

export async function getUnitLessonMatrixAction(groupId: string, unitId: string) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  // Get class and unit info
  const { rows: infoRows } = await query(
    `SELECT g.group_id, g.subject, u.unit_id, u.title as unit_title
     FROM groups g
     JOIN group_membership gm ON g.group_id = gm.group_id
     CROSS JOIN units u
     WHERE g.group_id = $1 AND u.unit_id = $2 AND gm.user_id = $3
     LIMIT 1`,
    [groupId, unitId, profile.userId]
  )

  if (infoRows.length === 0) {
    throw new Error('Class or unit not found or access denied')
  }

  // Get lesson-level metrics by aggregating activity feedback scores
  const { rows } = await query(
    `WITH lesson_activity_scores AS (
       SELECT
         l.lesson_id,
         l.title as lesson_title,
         l.order_by,
         gm.user_id as pupil_id,
         COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, gm.user_id) as pupil_name,
         a.activity_id,
         a.is_summative,
         paf.score
       FROM lessons l
       JOIN lesson_assignments la ON la.lesson_id = l.lesson_id AND la.group_id = $1
       JOIN group_membership gm ON gm.group_id = la.group_id
       JOIN profiles p ON p.user_id = gm.user_id
       LEFT JOIN activities a ON a.lesson_id = l.lesson_id
       LEFT JOIN pupil_activity_feedback paf ON paf.activity_id = a.activity_id AND paf.pupil_id = gm.user_id
       WHERE l.unit_id = $2
     )
     SELECT
       lesson_id,
       lesson_title,
       order_by,
       pupil_id,
       pupil_name,
       AVG(CASE WHEN is_summative = false THEN score END) as avg_completion,
       AVG(CASE WHEN is_summative = true THEN score END) as avg_assessment
     FROM lesson_activity_scores
     GROUP BY lesson_id, lesson_title, order_by, pupil_id, pupil_name
     ORDER BY order_by, pupil_name`,
    [groupId, unitId]
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
      pupilName: row.pupil_name as string,
      avgCompletion: row.avg_completion != null ? Number(row.avg_completion) : null,
      avgAssessment: row.avg_assessment != null ? Number(row.avg_assessment) : null,
    }))
  }
}

export async function getPupilUnitLessonsAction(groupId: string, unitId: string, pupilId: string) {
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

  // Get pupil info and cached report data
  const { rows: pupilRows } = await query(
    `SELECT
       p.user_id,
       COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name, p.user_id) as pupil_name,
       rpc.dataset,
       g.group_id,
       g.subject as group_subject,
       u.unit_id,
       u.title as unit_title
     FROM profiles p
     CROSS JOIN groups g
     CROSS JOIN units u
     LEFT JOIN report_pupil_cache rpc ON rpc.pupil_id = p.user_id
     WHERE p.user_id = $1 AND g.group_id = $2 AND u.unit_id = $3
     LIMIT 1`,
    [pupilId, groupId, unitId]
  )

  if (pupilRows.length === 0) {
    throw new Error('Pupil, class, or unit not found')
  }

  const pupilRow = pupilRows[0]
  const dataset = pupilRow.dataset as any

  const lessons: Array<{
    lessonId: string
    lessonTitle: string
    avgCompletion: number | null
    avgAssessment: number | null
  }> = []

  if (dataset && dataset.units) {
    const unit = dataset.units.find((u: any) => u.unit_id === unitId)
    if (unit && unit.lessons) {
      for (const lesson of unit.lessons) {
        const activities = lesson.activities || []
        const submissions = lesson.submissions || []

        let completionScores: number[] = []
        let assessmentScores: number[] = []

        for (const activity of activities) {
          if (!activity.is_scorable) continue

          const submission = submissions.find((s: any) => s.activity_id === activity.activity_id)
          if (!submission || submission.score == null) continue

          const score = Number(submission.score)
          if (activity.is_summative) {
            assessmentScores.push(score)
          } else {
            completionScores.push(score)
          }
        }

        lessons.push({
          lessonId: lesson.lesson_id,
          lessonTitle: lesson.title,
          avgCompletion: completionScores.length > 0
            ? completionScores.reduce((a, b) => a + b, 0) / completionScores.length
            : null,
          avgAssessment: assessmentScores.length > 0
            ? assessmentScores.reduce((a, b) => a + b, 0) / assessmentScores.length
            : null,
        })
      }
    }
  }

  return {
    groupId: pupilRow.group_id as string,
    groupSubject: pupilRow.group_subject as string,
    unitId: pupilRow.unit_id as string,
    unitTitle: pupilRow.unit_title as string,
    pupilId: pupilRow.user_id as string,
    pupilName: pupilRow.pupil_name as string,
    lessons
  }
}
