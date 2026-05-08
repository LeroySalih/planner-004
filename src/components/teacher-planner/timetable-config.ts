// src/components/teacher-planner/timetable-config.ts
import type { PeriodRow, TimetableSlot } from './types'

export const PERIOD_LAYOUT: PeriodRow[] = [
  { type: 'lesson', period: 1, label: 'L1', startTime: '07:15', endTime: '08:15' },
  { type: 'lesson', period: 2, label: 'L2', startTime: '08:15', endTime: '09:15' },
  { type: 'break',  label: 'Break' },
  { type: 'lesson', period: 3, label: 'L3', startTime: '09:30', endTime: '10:30' },
  { type: 'lesson', period: 4, label: 'L4', startTime: '10:30', endTime: '11:30' },
  { type: 'break',  label: 'Lunch' },
  { type: 'lesson', period: 5, label: 'L5', startTime: '12:15', endTime: '13:15' },
  { type: 'lesson', period: 6, label: 'L6', startTime: '13:15', endTime: '14:15' },
  { type: 'lesson', period: 7, label: 'L7', startTime: '14:15', endTime: '15:15' },
]

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'] as const

export const DAY_LABELS: Record<string, string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
}

export const TIMETABLE_SLOTS: TimetableSlot[] = [
  // Sunday
  { day: 'sunday',    period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'sunday',    period: 3, classCode: '8c/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '08:25', endTime: '09:25' },
  { day: 'sunday',    period: 5, classCode: '8b/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'sunday',    period: 6, classCode: '9c/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
  { day: 'sunday',    period: 7, classCode: '10Dt2/Dt',  subject: 'Design tech', room: 'FR87', startTime: '13:00', endTime: '14:00' },
  // Monday
  { day: 'monday',    period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'monday',    period: 3, classCode: '9a/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '08:25', endTime: '09:25' },
  { day: 'monday',    period: 4, classCode: '8d/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'monday',    period: 5, classCode: '7d/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'monday',    period: 6, classCode: '11Dt/Dt',   subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
  // Tuesday
  { day: 'tuesday',   period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'tuesday',   period: 4, classCode: '9d/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'tuesday',   period: 5, classCode: '10Dt2/Dt',  subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'tuesday',   period: 7, classCode: '11Dt/Dt',   subject: 'Design tech', room: 'FR87', startTime: '13:00', endTime: '14:00' },
  // Wednesday
  { day: 'wednesday', period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'wednesday', period: 3, classCode: '11Dt/Dt',   subject: 'Design tech', room: 'FR87', startTime: '08:25', endTime: '09:25' },
  { day: 'wednesday', period: 4, classCode: '7c/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'wednesday', period: 5, classCode: '7a/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'wednesday', period: 6, classCode: '7b/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
  // Thursday
  { day: 'thursday',  period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'thursday',  period: 2, classCode: '9b/pshe',   subject: 'PSHE',        room: 'MH Hall', startTime: '07:25', endTime: '08:25' },
  { day: 'thursday',  period: 4, classCode: '10Dt2/Dt',  subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'thursday',  period: 5, classCode: '9b/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'thursday',  period: 6, classCode: '8a/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
]
