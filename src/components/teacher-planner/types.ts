// src/components/teacher-planner/types.ts

export type Day = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday'

export type TimetableSlot = {
  day: Day
  period: number
  classCode: string   // matches group.subject in DB
  subject: string     // display string, e.g. "Design tech"
  room: string
  startTime?: string  // e.g. "08:25"
  endTime?: string    // e.g. "09:25"
}

export type PeriodRow =
  | { type: 'lesson'; period: number; label: string; startTime?: string; endTime?: string }
  | { type: 'break'; label: string }

export type CellState = {
  unitId: string | null
  lessonId: string | null
  groupId: string | null   // '__free__' = explicitly marked as free period
  feedbackVisible: boolean
  issueFlag: boolean
  issueNote: string
  lessonNotes: string
  assignmentId: string | null  // UUID of the corresponding planner_assignments row, null if not yet saved
}

export type PlannerState = Map<string, CellState>       // key: `${day}-${period}`
export type WeeklyPlannerState = Map<string, PlannerState> // key: ISO sunday date e.g. "2026-05-03"

export function slotKey(day: Day, period: number): string {
  return `${day}-${period}`
}

export function getTodaySunday(): string {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

export function shiftWeek(weekKey: string, delta: number): string {
  const d = new Date(weekKey + 'T00:00:00')
  d.setDate(d.getDate() + delta * 7)
  return d.toISOString().slice(0, 10)
}

export function formatWeekRange(weekKey: string): string {
  const sun = new Date(weekKey + 'T00:00:00')
  const thu = new Date(weekKey + 'T00:00:00')
  thu.setDate(thu.getDate() + 4)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `${fmt(sun)} – ${fmt(thu)} ${thu.getFullYear()}`
}

export function emptyCellState(): CellState {
  return {
    unitId: null,
    lessonId: null,
    groupId: null,
    feedbackVisible: false,
    issueFlag: false,
    issueNote: '',
    lessonNotes: '',
    assignmentId: null,
  }
}
