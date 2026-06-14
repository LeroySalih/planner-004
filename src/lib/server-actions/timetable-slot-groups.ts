'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile } from '@/lib/auth'
import { TimetableSlotGroupSchema, type TimetableSlotGroup } from '@/types'

const SlotGroupsResult = z.object({
  data: z.array(TimetableSlotGroupSchema).nullable(),
  error: z.string().nullable(),
})

const NullResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

export async function upsertTimetableSlotGroupAction(
  day: string,
  period: number,
  groupId: string | null,
): Promise<z.infer<typeof NullResult>> {
  try {
    const profile = await requireTeacherProfile()
    await query(
      `INSERT INTO timetable_slot_groups (teacher_id, day, period, group_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (teacher_id, day, period)
       DO UPDATE SET group_id = EXCLUDED.group_id`,
      [profile.userId, day, period, groupId],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save slot group'
    return NullResult.parse({ data: null, error: message })
  }
}

export async function readTimetableSlotGroupsAction(teacherId?: string): Promise<z.infer<typeof SlotGroupsResult>> {
  try {
    const profile = await requireTeacherProfile()
    const targetTeacherId = teacherId ?? profile.userId
    const { rows } = await query<TimetableSlotGroup>(
      `SELECT teacher_id, day, period, group_id
       FROM timetable_slot_groups
       WHERE teacher_id = $1`,
      [targetTeacherId],
    )
    const data = rows.map((row) => TimetableSlotGroupSchema.parse({ ...row, period: Number(row.period) }))
    return SlotGroupsResult.parse({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load slot groups'
    return SlotGroupsResult.parse({ data: null, error: message })
  }
}
