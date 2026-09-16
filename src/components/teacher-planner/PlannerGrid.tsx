'use client'

import { PlannerCell } from './PlannerCell'
import { PERIOD_LAYOUT, DAYS, DAY_LABELS } from './timetable-config'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day, CellState, PeriodRow } from './types'
import type { Unit, Group, LessonWithObjectives } from '@/types'

type PlannerGridProps = {
  units: Unit[]
  /** group id -> units in that group's scheme of work for this half-term. */
  sowUnits?: Map<string, Set<string>>
  groups: Group[]
  plannerState: PlannerState
  selectedSlot: string | null
  lessonCache: Map<string, LessonWithObjectives[]>
  lessonScores: Map<string, number | null>
  /** slotKey -> the lesson in that slot the previous week, for the HW link. */
  lastWeekBySlot: Map<string, { lessonId: string; groupId: string }>
  /** Sunday that starts the displayed week, ISO. Used by the per-day plan download. */
  currentWeek: string
  /** Whose timetable is on screen — an admin may be viewing another teacher's. */
  teacherId: string
  onCellClick: (day: Day, period: number) => void
  onUnitSelect: (unitId: string) => void
  onLessonChange: (day: Day, period: number, lessonId: string) => void
  onFeedbackToggle: (day: Day, period: number, lessonId: string) => void
  readOnly?: boolean
}

type LessonRow = Extract<PeriodRow, { type: 'lesson' }>
type BreakRow = Extract<PeriodRow, { type: 'break' }>

// Interleave lesson periods with break dividers for column rendering
type Col = { kind: 'lesson'; row: LessonRow } | { kind: 'break'; row: BreakRow }

function buildColumns(): Col[] {
  const cols: Col[] = []
  for (const row of PERIOD_LAYOUT) {
    if (row.type === 'lesson') {
      cols.push({ kind: 'lesson', row })
    } else {
      cols.push({ kind: 'break', row })
    }
  }
  return cols
}

const COLUMNS = buildColumns()
// Grid: day-label col + one col per entry in COLUMNS
const GRID_TEMPLATE =
  '64px ' +
  COLUMNS.map((c) => (c.kind === 'break' ? '36px' : 'minmax(0, 1fr)')).join(' ')

export function PlannerGrid({
  units,
  sowUnits,
  groups,
  plannerState,
  selectedSlot,
  lessonCache,
  lessonScores,
  lastWeekBySlot,
  currentWeek,
  teacherId,
  onCellClick,
  onUnitSelect,
  onLessonChange,
  onFeedbackToggle,
  readOnly,
}: PlannerGridProps) {
  // Build a map from group_id → subject for fast lookup
  const groupSubjectMap = new Map(groups.map((g) => [g.group_id, g.subject]))
  return (
    <div className="text-[13px]">
      {/* Period header row */}
      <div className="grid gap-[4px] mb-[4px]" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
        <div />
        {COLUMNS.map((col, i) => {
          if (col.kind === 'break') {
            return (
              <div
                key={`hbreak-${i}`}
                className="flex items-end justify-center pb-1 text-[9px] text-[var(--color-text-tertiary)] opacity-60 tracking-wide leading-tight text-center"
              >
                {col.row.label}
              </div>
            )
          }
          return (
            <div
              key={`hperiod-${col.row.period}`}
              className="text-center px-1 py-1.5"
            >
              <div className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                {col.row.label}
              </div>
              {col.row.startTime && (
                <div className="text-[10px] text-[var(--color-text-tertiary)] leading-tight">
                  {col.row.startTime}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Day rows */}
      <div className="flex flex-col gap-[4px]">
        {DAYS.map((day) => (
          <div
            key={day}
            className="grid gap-[4px]"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            {/* Day label, and the day's plans as one download */}
            <div className="flex flex-col items-end justify-center pr-2">
              <span className="font-medium text-[12px] text-[var(--color-text-secondary)]">
                {DAY_LABELS[day]}
              </span>
              {/* Offered only when there is something to archive — the route
                  404s on an empty day, and a link that downloads nothing is
                  worse than no link. */}
              {[...plannerState.entries()].some(
                ([key, state]) => key.startsWith(`${day}-`) && state.lessons.length > 0,
              ) ? (
                <a
                  href={`/api/lesson-plans/day?day=${day}&week=${encodeURIComponent(currentWeek)}&teacherId=${encodeURIComponent(teacherId)}`}
                  download
                  className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)] underline-offset-2 hover:text-[var(--color-text-primary)] hover:underline"
                  title={`Download every lesson plan for ${DAY_LABELS[day]} as a zip`}
                >
                  Plans
                </a>
              ) : null}
            </div>

            {/* Period cells */}
            {COLUMNS.map((col, i) => {
              if (col.kind === 'break') {
                return (
                  <div
                    key={`break-${day}-${i}`}
                    className="rounded-[6px] bg-[var(--color-background-secondary)] opacity-40"
                  />
                )
              }

              const key = slotKey(day, col.row.period)
              const state: CellState = plannerState.get(key) ?? emptyCellState()
              const groupSubject = state.groupId ? groupSubjectMap.get(state.groupId) : undefined
              const cellUnits = groupSubject
                ? units.filter((u) => u.subject === groupSubject && u.active !== false)
                : []

              return (
                <PlannerCell
                  key={key}
                  day={day}
                  period={col.row.period}
                  cellState={state}
                  isSelected={selectedSlot === key}
                  units={cellUnits}
                  sowUnitIds={state.groupId ? sowUnits?.get(state.groupId) : undefined}
                  lessonCache={lessonCache}
                  lessonScores={lessonScores}
                  lastWeek={lastWeekBySlot.get(key) ?? null}
                  onCellClick={onCellClick}
                  onUnitSelect={onUnitSelect}
                  onLessonChange={onLessonChange}
                  onFeedbackToggle={onFeedbackToggle}
                  readOnly={readOnly}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
