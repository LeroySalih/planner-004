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
  feedbackVisible: boolean
  issueFlag: boolean
  issueNote: string
  lessonNotes: string
}

export type PlannerState = Map<string, CellState>  // key: `${day}-${period}`

export function slotKey(day: Day, period: number): string {
  return `${day}-${period}`
}

export function emptyCellState(): CellState {
  return {
    unitId: null,
    lessonId: null,
    feedbackVisible: false,
    issueFlag: false,
    issueNote: '',
    lessonNotes: '',
  }
}
