'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile } from '@/lib/auth'
import {
  PlannerAssignmentSchema,
  PlannerAssignmentWithUnitSchema,
  type PlannerAssignment,
  type PlannerAssignmentWithUnit,
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
       ON CONFLICT (group_id, week_start_date, day, period)
       DO UPDATE SET
         lesson_id        = EXCLUDED.lesson_id,
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
       WHERE group_id = $1 AND week_start_date = $2 AND day = $3 AND period = $4`,
      [groupId, weekStartDate, day, period],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete assignment'
    return NullResult.parse({ data: null, error: message })
  }
}

export async function readPlannerAssignmentsForWeekAction(
  weekStartDate: string,
): Promise<z.infer<typeof AssignmentsWithUnitResult>> {
  try {
    const profile = await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return AssignmentsWithUnitResult.parse({ data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' })
    }
    const { rows } = await query<Record<string, unknown>>(
      `SELECT pa.*, l.unit_id
       FROM planner_assignments pa
       JOIN lessons l ON l.lesson_id = pa.lesson_id
       JOIN timetable_slot_groups tsg
         ON tsg.teacher_id = $1 AND tsg.day = pa.day AND tsg.period = pa.period
       WHERE pa.week_start_date = $2`,
      [profile.userId, weekStartDate],
    )
    const data = rows.map((row) =>
      PlannerAssignmentWithUnitSchema.parse({
        ...toAssignment(row),
        unit_id: row.unit_id,
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
