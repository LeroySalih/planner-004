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

export type SlotLesson = {
  lessonId: string
  unitId: string
  lessonTitle: string
  assignmentId: string
  feedbackVisible: boolean
  issueFlag: boolean
  issueNote: string
  lessonNotes: string
}

export type CellState = {
  groupId: string | null
  lessons: SlotLesson[]
}

export type PlannerState = Map<string, CellState>       // key: `${day}-${period}`
export type WeeklyPlannerState = Map<string, PlannerState> // key: ISO sunday date e.g. "2026-05-03"

export function slotKey(day: Day, period: number): string {
  return `${day}-${period}`
}

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getTodaySunday(): string {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return localDateStr(d)
}

export function shiftWeek(weekKey: string, delta: number): string {
  const [y, m, day] = weekKey.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  d.setDate(d.getDate() + delta * 7)
  return localDateStr(d)
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
  return { groupId: null, lessons: [] }
}
