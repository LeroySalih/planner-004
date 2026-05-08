'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile } from '@/lib/auth'

const PeriodFlagSchema = z.object({
  id: z.string(),
  week_start_date: z.string(),
  day: z.string(),
  period: z.number(),
  issue_flag: z.boolean(),
  issue_note: z.string(),
})

export type PeriodFlag = z.infer<typeof PeriodFlagSchema>

function toFlag(row: Record<string, unknown>): PeriodFlag {
  return PeriodFlagSchema.parse({
    ...row,
    week_start_date:
      row.week_start_date instanceof Date
        ? row.week_start_date.toISOString().slice(0, 10)
        : String(row.week_start_date),
    period: Number(row.period),
  })
}

export async function readPlannerPeriodFlagsForWeekAction(
  weekStartDate: string,
): Promise<{ data: PeriodFlag[] | null; error: string | null }> {
  try {
    await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return { data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' }
    }
    const { rows } = await query<Record<string, unknown>>(
      `SELECT * FROM planner_period_flags WHERE week_start_date = $1`,
      [weekStartDate],
    )
    return { data: rows.map(toFlag), error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Failed to load period flags' }
  }
}

export async function upsertPlannerPeriodFlagAction(
  weekStartDate: string,
  day: string,
  period: number,
  issueFlag: boolean,
  issueNote: string,
): Promise<{ data: PeriodFlag | null; error: string | null }> {
  try {
    await requireTeacherProfile()
    if (!weekStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return { data: null, error: 'weekStartDate must be ISO YYYY-MM-DD' }
    }
    const { rows } = await query<Record<string, unknown>>(
      `INSERT INTO planner_period_flags (week_start_date, day, period, issue_flag, issue_note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (week_start_date, day, period)
       DO UPDATE SET issue_flag = EXCLUDED.issue_flag, issue_note = EXCLUDED.issue_note, updated_at = now()
       RETURNING *`,
      [weekStartDate, day, period, issueFlag, issueNote],
    )
    return { data: toFlag(rows[0]), error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Failed to save period flag' }
  }
}
