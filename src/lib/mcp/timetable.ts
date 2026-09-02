import { query } from '@/lib/db'
import { DAYS, PERIOD_LAYOUT } from '@/components/teacher-planner/timetable-config'

/**
 * Timetable slot CRUD for the MCP interface.
 *
 * MCP authenticates with a service key and carries no user identity, so every
 * call must name its teacher explicitly — unlike the app's server actions,
 * which default to the signed-in profile and cannot be reused here.
 *
 * A slot is uniquely (teacher, day, period). There is no separate create and
 * update: setting a slot upserts. Three states, and they are not the same:
 *
 *   - no row          — the slot has never been set
 *   - row, group NULL — explicitly a free period
 *   - row, group set  — that class
 *
 * The planner renders the first two identically, but deleting and freeing are
 * different operations, so both are exposed.
 */

export const VALID_DAYS = DAYS as readonly string[]
export const VALID_PERIODS = PERIOD_LAYOUT.filter((r) => r.type === 'lesson').map(
  (r) => (r as { period: number }).period,
)

export type TeacherSummary = {
  user_id: string
  name: string
  email: string | null
}

export type GroupSummary = {
  group_id: string
  subject: string | null
  is_active: boolean
}

export type TimetableSlot = {
  day: string
  period: number
  group_id: string | null
}

export async function listTeachers(): Promise<TeacherSummary[]> {
  const { rows } = await query(
    `SELECT user_id, first_name, last_name, email
       FROM profiles
      WHERE is_teacher = true
      ORDER BY last_name NULLS LAST, first_name NULLS LAST`,
  )
  return (rows ?? []).map((r) => ({
    user_id: String(r.user_id ?? ''),
    name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || String(r.user_id ?? ''),
    email: typeof r.email === 'string' ? r.email : null,
  }))
}

export async function listGroups(includeInactive = false): Promise<GroupSummary[]> {
  const { rows } = await query(
    `SELECT group_id, subject, active
       FROM groups
      ${includeInactive ? '' : 'WHERE active IS NOT FALSE'}
      ORDER BY group_id ASC`,
  )
  return (rows ?? []).map((r) => ({
    group_id: String(r.group_id ?? ''),
    subject: typeof r.subject === 'string' ? r.subject : null,
    is_active: r.active !== false,
  }))
}

/**
 * Resolve a teacher from an email or a user id.
 *
 * Accepts either because a caller driving this conversationally will know an
 * email and not a uuid. Email is matched case-insensitively, which is how the
 * profiles table is indexed.
 */
export async function resolveTeacherId(teacher: string): Promise<string> {
  const value = teacher.trim()
  if (!value) throw new Error('A teacher email or user id is required.')

  const { rows } = await query<{ user_id: string; is_teacher: boolean }>(
    `SELECT user_id, is_teacher FROM profiles
      WHERE user_id = $1 OR lower(email) = lower($1)
      LIMIT 1`,
    [value],
  )
  const row = rows[0]
  if (!row) throw new Error(`No profile found for "${teacher}". Use list_teachers to find one.`)
  if (!row.is_teacher) throw new Error(`"${teacher}" is not a teacher.`)
  return row.user_id
}

function assertDayAndPeriod(day: string, period: number): void {
  if (!VALID_DAYS.includes(day)) {
    throw new Error(`Invalid day "${day}". Expected one of: ${VALID_DAYS.join(', ')}.`)
  }
  if (!VALID_PERIODS.includes(period)) {
    throw new Error(`Invalid period ${period}. Expected one of: ${VALID_PERIODS.join(', ')}.`)
  }
}

export async function listTimetableSlots(teacherId: string): Promise<TimetableSlot[]> {
  const { rows } = await query(
    `SELECT day, period, group_id
       FROM timetable_slot_groups
      WHERE teacher_id = $1
      ORDER BY period`,
    [teacherId],
  )
  const order = new Map(VALID_DAYS.map((d, i) => [d, i]))
  return (rows ?? [])
    .map((r) => ({
      day: String(r.day ?? ''),
      period: Number(r.period),
      group_id: typeof r.group_id === 'string' ? r.group_id : null,
    }))
    .sort((a, b) => (order.get(a.day) ?? 99) - (order.get(b.day) ?? 99) || a.period - b.period)
}

/**
 * Create or update a slot. Passing no group marks the slot a free period,
 * which is a stored fact — distinct from the slot never having been set.
 */
export async function setTimetableSlot(input: {
  teacherId: string
  day: string
  period: number
  groupId?: string | null
}): Promise<TimetableSlot> {
  assertDayAndPeriod(input.day, input.period)

  const groupId = input.groupId?.trim() ? input.groupId.trim() : null
  if (groupId) {
    // Checked here rather than relying on a foreign key so the caller gets a
    // usable message instead of a constraint violation.
    const { rows } = await query<{ group_id: string }>(
      'SELECT group_id FROM groups WHERE group_id = $1 LIMIT 1',
      [groupId],
    )
    if (!rows[0]) throw new Error(`No group "${groupId}". Use list_groups to find one.`)
  }

  await query(
    `INSERT INTO timetable_slot_groups (teacher_id, day, period, group_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (teacher_id, day, period)
     DO UPDATE SET group_id = EXCLUDED.group_id`,
    [input.teacherId, input.day, input.period, groupId],
  )

  return { day: input.day, period: input.period, group_id: groupId }
}

/** Remove a slot entirely. Returns false when there was nothing to remove. */
export async function deleteTimetableSlot(
  teacherId: string,
  day: string,
  period: number,
): Promise<boolean> {
  assertDayAndPeriod(day, period)
  const { rowCount } = await query(
    'DELETE FROM timetable_slot_groups WHERE teacher_id = $1 AND day = $2 AND period = $3',
    [teacherId, day, period],
  )
  return (rowCount ?? 0) > 0
}
