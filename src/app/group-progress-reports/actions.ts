'use server'

import { query } from '@/lib/db'
import { requireAuthenticatedProfile } from '@/lib/auth'
import { resolvePupilIds } from '@/lib/roles/pupil-membership'

/**
 * Every class with its overall score, from the progress baseline view
 * (pupil_activity_scores, migration 117): total marks over total available
 * across everything set to the class.
 */
export async function getGroupProgressListAction(summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  const { rows } = await query(
    `SELECT
       g.group_id,
       g.subject,
       g.active,
       COUNT(DISTINCT pas.pupil_id) as pupil_count,
       COUNT(DISTINCT pas.unit_id) as unit_count,
       (SUM(pas.marks) FILTER (WHERE NOT $1 OR pas.is_summative)::numeric
         / NULLIF(SUM(pas.max_marks) FILTER (WHERE NOT $1 OR pas.is_summative), 0)) * 100 as avg_score
     FROM pupil_activity_scores pas
     JOIN groups g ON g.group_id = pas.group_id
     GROUP BY g.group_id, g.subject, g.active
     ORDER BY g.subject, g.group_id`,
    [summativeOnly],
  )

  return rows.map((row) => ({
    groupId: row.group_id as string,
    subject: row.subject as string,
    // groups.active is nullable and defaults to true.
    active: row.active !== false,
    pupilCount: Number(row.pupil_count),
    unitCount: Number(row.unit_count),
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
  }))
}

/**
 * One class: each pupil's marks per unit, from the baseline view, with units
 * in the order the class started them; and each pupil's result on every
 * active assessment paper set to the class, in date order.
 */
export async function getGroupProgressAction(groupId: string, summativeOnly = false) {
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    throw new Error('Unauthorized')
  }

  const { rows: groupRows } = await query(
    `SELECT group_id, subject FROM groups WHERE group_id = $1 LIMIT 1`,
    [groupId],
  )

  if (groupRows.length === 0) {
    throw new Error('Class not found')
  }

  const { rows } = await query(
    `SELECT
       u.unit_id,
       u.title as unit_title,
       MIN(pas.start_date) as start_date,
       pas.pupil_id,
       p.first_name,
       p.last_name,
       SUM(pas.marks) FILTER (WHERE NOT $2 OR pas.is_summative) as marks,
       SUM(pas.max_marks) FILTER (WHERE NOT $2 OR pas.is_summative) as max_marks
     FROM pupil_activity_scores pas
     JOIN units u ON u.unit_id = pas.unit_id
     JOIN profiles p ON p.user_id = pas.pupil_id
     WHERE pas.group_id = $1
     GROUP BY u.unit_id, u.title, pas.pupil_id, p.first_name, p.last_name
     ORDER BY p.last_name, p.first_name`,
    [groupId, summativeOnly],
  )

  // Each unit's first lesson start date across the class, for column order.
  const unitStarts = new Map<string, { unitId: string; unitTitle: string; start: number }>()
  for (const row of rows) {
    const unitId = row.unit_id as string
    const start = row.start_date ? new Date(row.start_date as string | Date).getTime() : Number.POSITIVE_INFINITY
    const unit = unitStarts.get(unitId)
    if (!unit) unitStarts.set(unitId, { unitId, unitTitle: row.unit_title as string, start })
    else unit.start = Math.min(unit.start, start)
  }
  const units = Array.from(unitStarts.values())
    .sort((a, b) => a.start - b.start || a.unitTitle.localeCompare(b.unitTitle))
    .map(({ unitId, unitTitle }) => ({ unitId, unitTitle }))

  // A paper's score is every mark awarded over the paper's total: a question
  // with no mark is 0 and stays in the total, as on the paper's own results.
  // A pupil with no marks at all on a paper has no result for it.
  const { rows: paperRows } = await query(
    `WITH papers AS (
       SELECT a.assessment_id, a.title, a.assessed_on, a.created_at,
              (SELECT COALESCE(SUM(q.max_marks), 0) FROM assessment_questions q
                WHERE q.assessment_id = a.assessment_id) as total_marks
         FROM assessments a
         JOIN assessment_groups ag ON ag.assessment_id = a.assessment_id AND ag.group_id = $1
        WHERE a.active
     ), results AS (
       SELECT m.assessment_id, m.pupil_id, SUM(m.awarded) as awarded
         FROM assessment_question_marks m
         JOIN papers ON papers.assessment_id = m.assessment_id
         JOIN group_membership gm ON gm.group_id = $1 AND gm.user_id = m.pupil_id
        WHERE m.pupil_id = ANY($2::text[])
        GROUP BY m.assessment_id, m.pupil_id
     )
     SELECT papers.assessment_id::text as assessment_id, papers.title, papers.total_marks,
            r.pupil_id, p.first_name, p.last_name, r.awarded
       FROM papers
       LEFT JOIN results r ON r.assessment_id = papers.assessment_id
       LEFT JOIN profiles p ON p.user_id = r.pupil_id
      ORDER BY papers.assessed_on, papers.created_at`,
    [groupId, await resolvePupilIds(query)],
  )

  const assessments: { assessmentId: string; title: string }[] = []
  const seenPapers = new Set<string>()
  const assessmentResults: { assessmentId: string; pupilId: string; firstName: string; lastName: string; marks: number; maxMarks: number }[] = []
  for (const row of paperRows) {
    const assessmentId = row.assessment_id as string
    if (!seenPapers.has(assessmentId)) {
      seenPapers.add(assessmentId)
      assessments.push({ assessmentId, title: row.title as string })
    }
    if (row.pupil_id) {
      assessmentResults.push({
        assessmentId,
        pupilId: row.pupil_id as string,
        firstName: row.first_name as string,
        lastName: row.last_name as string,
        marks: Number(row.awarded),
        maxMarks: Number(row.total_marks),
      })
    }
  }

  return {
    groupId: groupRows[0].group_id as string,
    groupSubject: groupRows[0].subject as string,
    units,
    assessments,
    assessmentResults,
    cells: rows.map((row) => ({
      unitId: row.unit_id as string,
      pupilId: row.pupil_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      marks: row.marks != null ? Number(row.marks) : 0,
      maxMarks: row.max_marks != null ? Number(row.max_marks) : 0,
    })),
  }
}
