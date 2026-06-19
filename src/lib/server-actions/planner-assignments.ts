'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile } from '@/lib/auth'
import {
  PlannerAssignmentSchema,
  PlannerAssignmentWithUnitSchema,
  type PlannerAssignment,
} from '@/types'

const AssignmentResult = z.object({
  data: PlannerAssignmentSchema.nullable(),
  error: z.string().nullable(),
})

const AssignmentsWithUnitResult = z.object({
  data: z.array(PlannerAssignmentWithUnitSchema).nullable(),
  error: z.string().nullable(),
})

const NullResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

function toAssignment(row: Record<string, unknown>): PlannerAssignment {
  return PlannerAssignmentSchema.parse({
    ...row,
    week_start_date:
      row.week_start_date instanceof Date
        ? row.week_start_date.toISOString().slice(0, 10)
        : String(row.week_start_date),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  })
}

export async function upsertPlannerAssignmentAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
  day: string,
  period: number,
  extras?: {
    notes?: string
    issueFlag?: boolean
    issueNote?: string
    feedbackVisible?: boolean
  },
): Promise<z.infer<typeof AssignmentResult>> {
  try {
    const profile = await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return AssignmentResult.parse({ data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' })
    }
    const { rows } = await query<Record<string, unknown>>(
      `INSERT INTO planner_assignments
         (group_id, lesson_id, week_start_date, day, period,
          feedback_visible, issue_flag, issue_note, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (group_id, week_start_date, day, period, lesson_id)
       DO UPDATE SET
         feedback_visible = EXCLUDED.feedback_visible,
         issue_flag       = EXCLUDED.issue_flag,
         issue_note       = EXCLUDED.issue_note,
         notes            = EXCLUDED.notes,
         updated_at       = now()
       RETURNING *`,
      [
        groupId,
        lessonId,
        weekStartDate,
        day,
        period,
        extras?.feedbackVisible ?? false,
        extras?.issueFlag ?? false,
        extras?.issueNote ?? '',
        extras?.notes ?? '',
        profile.userId,
      ],
    )
    return AssignmentResult.parse({ data: toAssignment(rows[0]), error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save assignment'
    return AssignmentResult.parse({ data: null, error: message })
  }
}

export async function deletePlannerAssignmentAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
  day: string,
  period: number,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return NullResult.parse({ data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' })
    }
    await query(
      `DELETE FROM planner_assignments
       WHERE group_id = $1 AND lesson_id = $2 AND week_start_date = $3 AND day = $4 AND period = $5`,
      [groupId, lessonId, weekStartDate, day, period],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete assignment'
    return NullResult.parse({ data: null, error: message })
  }
}

export async function readPlannerAssignmentsForWeekAction(
  weekStartDate: string,
  teacherId?: string,
): Promise<z.infer<typeof AssignmentsWithUnitResult>> {
  try {
    const profile = await requireTeacherProfile()
    const targetTeacherId = teacherId ?? profile.userId
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return AssignmentsWithUnitResult.parse({ data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' })
    }
    const { rows } = await query<Record<string, unknown>>(
      `SELECT pa.*, l.unit_id, l.title AS lesson_title
       FROM planner_assignments pa
       JOIN lessons l ON l.lesson_id = pa.lesson_id
       JOIN timetable_slot_groups tsg
         ON tsg.teacher_id = $1 AND tsg.day = pa.day AND tsg.period = pa.period
       WHERE pa.week_start_date = $2`,
      [targetTeacherId, weekStartDate],
    )
    const data = rows.map((row) =>
      PlannerAssignmentWithUnitSchema.parse({
        ...toAssignment(row),
        unit_id: row.unit_id,
        lesson_title: row.lesson_title,
      }),
    )
    return AssignmentsWithUnitResult.parse({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load week assignments'
    return AssignmentsWithUnitResult.parse({ data: null, error: message })
  }
}

export async function updatePlannerAssignmentExtrasAction(
  id: string,
  patch: Partial<Pick<PlannerAssignment, 'notes' | 'issue_flag' | 'issue_note' | 'feedback_visible'>>,
): Promise<z.infer<typeof AssignmentResult>> {
  try {
    await requireTeacherProfile()
    if (Object.keys(patch).filter(k => patch[k as keyof typeof patch] !== undefined).length === 0) {
      return AssignmentResult.parse({ data: null, error: 'No fields to update' })
    }
    const setClauses: string[] = ['updated_at = now()']
    const params: unknown[] = [id]
    let idx = 2
    if (patch.notes !== undefined) { setClauses.push(`notes = $${idx++}`); params.push(patch.notes) }
    if (patch.issue_flag !== undefined) { setClauses.push(`issue_flag = $${idx++}`); params.push(patch.issue_flag) }
    if (patch.issue_note !== undefined) { setClauses.push(`issue_note = $${idx++}`); params.push(patch.issue_note) }
    if (patch.feedback_visible !== undefined) { setClauses.push(`feedback_visible = $${idx++}`); params.push(patch.feedback_visible) }
    const { rows } = await query<Record<string, unknown>>(
      `UPDATE planner_assignments SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    )
    if (rows.length === 0) return AssignmentResult.parse({ data: null, error: 'Assignment not found' })
    return AssignmentResult.parse({ data: toAssignment(rows[0]), error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update assignment'
    return AssignmentResult.parse({ data: null, error: message })
  }
}

const SowWeekLessonSchema = z.object({
  lesson_id: z.string(),
  unit_id: z.string(),
  lesson_title: z.string(),
  week_start_date: z.string(),
  los: z.array(z.string()).default([]),
  score: z.number().nullable().default(null),
})

const SowWeekLessonsResult = z.object({
  data: z.array(SowWeekLessonSchema).nullable(),
  error: z.string().nullable(),
})

export type SowWeekLesson = z.infer<typeof SowWeekLessonSchema>

export async function readGroupSowLessonsAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowWeekLessonsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT DISTINCT ON (pa.week_start_date, pa.lesson_id)
              pa.lesson_id, l.unit_id, l.title AS lesson_title,
              pa.week_start_date::text AS week_start_date,
              COALESCE(
                (SELECT array_agg(lo.title ORDER BY llo.order_by)
                 FROM lessons_learning_objective llo
                 JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
                 WHERE llo.lesson_id = l.lesson_id AND lo.active IS NOT FALSE),
                '{}'
              ) AS los,
              (
                SELECT ROUND(100.0 * AVG(compute_submission_base_score(s.body, a.type)))
                FROM activities a
                JOIN submissions s ON s.activity_id = a.activity_id
                JOIN group_membership gm ON gm.user_id = s.user_id AND gm.group_id = pa.group_id
                WHERE a.lesson_id = pa.lesson_id
                  AND (a.active IS NULL OR a.active = true)
                  AND compute_submission_base_score(s.body, a.type) IS NOT NULL
              ) AS score
       FROM planner_assignments pa
       JOIN lessons l ON l.lesson_id = pa.lesson_id
       JOIN half_terms h1 ON h1.year = $2 AND h1.name = 'H1'
       JOIN half_terms h6 ON h6.year = $2 AND h6.name = 'H6'
       WHERE pa.group_id = $1
         AND pa.week_start_date BETWEEN h1.start_date AND h6.end_date
       ORDER BY pa.week_start_date, pa.lesson_id`,
      [groupId, year],
    )
    const data = rows.map((r) => SowWeekLessonSchema.parse(r))
    return SowWeekLessonsResult.parse({ data, error: null })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load SoW lessons'
    return SowWeekLessonsResult.parse({ data: null, error: message })
  }
}
