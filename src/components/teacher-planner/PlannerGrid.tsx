'use client'

import { cn } from '@/lib/utils'
import { PlannerCell } from './PlannerCell'
import { PERIOD_LAYOUT, TIMETABLE_SLOTS, DAYS, DAY_LABELS } from './timetable-config'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day, CellState } from './types'
import type { Unit, Lesson } from '@/types'

type PlannerGridProps = {
  units: Unit[]
  plannerState: PlannerState
  selectedSlot: string | null
  lessonCache: Map<string, Lesson[]>
  onCellClick: (day: Day, period: number) => void
  onUnitChange: (day: Day, period: number, unitId: string) => void
  onLessonChange: (day: Day, period: number, lessonId: string) => void
  onFeedbackToggle: (day: Day, period: number) => void
}

export function PlannerGrid({
  units,
  plannerState,
  selectedSlot,
  lessonCache,
  onCellClick,
  onUnitChange,
  onLessonChange,
  onFeedbackToggle,
}: PlannerGridProps) {
  return (
    <div className="text-[13px]">
      {/* Day headers */}
      <div className="grid gap-[4px]" style={{ gridTemplateColumns: '70px repeat(5, minmax(0, 1fr))' }}>
        <div />
        {DAYS.map((day) => (
          <div
            key={day}
            className="text-[12px] font-medium text-[var(--color-text-secondary)] text-center px-1 py-1.5"
          >
            {DAY_LABELS[day]}
          </div>
        ))}
      </div>

      {/* Period rows */}
      <div className="flex flex-col gap-[4px] mt-[4px]">
        {PERIOD_LAYOUT.map((row, idx) => {
          if (row.type === 'break') {
            return (
              <div
                key={`break-${idx}`}
                className="grid gap-[4px]"
                style={{ gridTemplateColumns: '70px repeat(5, minmax(0, 1fr))' }}
              >
                <div />
                <div
                  className="col-span-5 rounded-[8px] bg-[var(--color-background-secondary)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] text-center tracking-wide"
                >
                  {row.label}
                </div>
              </div>
            )
          }

          return (
            <div
              key={`period-${row.period}`}
              className="grid gap-[4px]"
              style={{ gridTemplateColumns: '70px repeat(5, minmax(0, 1fr))' }}
            >
              {/* Row label */}
              <div className="flex flex-col items-end justify-center pr-2 text-right">
                <span className="font-medium text-[13px] text-[var(--color-text-primary)]">{row.label}</span>
                {row.startTime && (
                  <span className="text-[10px] text-[var(--color-text-secondary)] leading-tight">{row.startTime}</span>
                )}
              </div>

              {/* Cells for each day */}
              {DAYS.map((day) => {
                const slot = TIMETABLE_SLOTS.find(
                  (s) => s.day === day && s.period === row.period,
                )

                if (!slot) {
                  return (
                    <div
                      key={day}
                      className="rounded-[8px] border border-[var(--color-border-tertiary)] min-h-[86px] bg-[var(--color-background-secondary)] opacity-30"
                    />
                  )
                }

                const key = slotKey(day, row.period)
                const state: CellState = plannerState.get(key) ?? emptyCellState()
                const lessons = lessonCache.get(state.unitId ?? '') ?? []

                return (
                  <PlannerCell
                    key={day}
                    slot={slot}
                    state={state}
                    isSelected={selectedSlot === key}
                    units={units}
                    lessons={lessons}
                    onCellClick={() => onCellClick(day, row.period)}
                    onUnitChange={(unitId) => onUnitChange(day, row.period, unitId)}
                    onLessonChange={(lessonId) => onLessonChange(day, row.period, lessonId)}
                    onFeedbackToggle={() => onFeedbackToggle(day, row.period)}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
