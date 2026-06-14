'use client'

import { PlannerCell } from './PlannerCell'
import { PERIOD_LAYOUT, DAYS, DAY_LABELS } from './timetable-config'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day, CellState, PeriodRow } from './types'
import type { Unit, Group, LessonWithObjectives } from '@/types'

type PlannerGridProps = {
  units: Unit[]
  groups: Group[]
  plannerState: PlannerState
  selectedSlot: string | null
  lessonCache: Map<string, LessonWithObjectives[]>
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
  groups,
  plannerState,
  selectedSlot,
  lessonCache,
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
            {/* Day label */}
            <div className="flex items-center justify-end pr-2">
              <span className="font-medium text-[12px] text-[var(--color-text-secondary)]">
                {DAY_LABELS[day]}
              </span>
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
                  lessonCache={lessonCache}
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
