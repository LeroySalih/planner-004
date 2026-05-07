'use client'

import { cn } from '@/lib/utils'
import type { TimetableSlot, CellState } from './types'
import type { Unit, Lesson } from '@/types'

type PlannerCellProps = {
  slot: TimetableSlot
  state: CellState
  isSelected: boolean
  units: Unit[]
  lessons: Lesson[]
  onCellClick: () => void
  onUnitChange: (unitId: string) => void
  onLessonChange: (lessonId: string) => void
  onFeedbackToggle: () => void
}

export function PlannerCell({
  slot,
  state,
  isSelected,
  units,
  lessons,
  onCellClick,
  onUnitChange,
  onLessonChange,
  onFeedbackToggle,
}: PlannerCellProps) {
  const selectedUnit = units.find((u) => u.unit_id === state.unitId) ?? null
  const selectedLesson = lessons.find((l) => l.lesson_id === state.lessonId) ?? null

  return (
    <div
      className={cn(
        'relative flex flex-col gap-[3px] rounded-[8px] border bg-[var(--color-background-primary)] px-[7px] py-[6px] min-h-[86px] cursor-pointer transition-colors',
        state.issueFlag
          ? 'bg-[#FCEBEB] border-[#F09595] hover:border-[#E24B4A]'
          : 'border-[var(--color-border-tertiary)] hover:border-[var(--color-border-secondary)]',
        isSelected && !state.issueFlag && 'border-[1.5px] border-[var(--color-border-info)]',
        isSelected && state.issueFlag && 'border-[1.5px] border-[#E24B4A]',
      )}
      onClick={onCellClick}
    >
      {/* Header */}
      <div className="flex justify-between items-baseline gap-1 mb-0.5">
        <span
          className={cn(
            'font-medium text-[12px]',
            state.issueFlag ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]',
          )}
        >
          {slot.classCode}
        </span>
        <span
          className={cn(
            'text-[11px] truncate',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-secondary)]',
          )}
        >
          {slot.subject}
        </span>
      </div>

      {/* Unit picker */}
      <div
        className="relative flex items-center h-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={cn(
            'flex-1 min-w-0 text-[11px] truncate pr-0.5',
            selectedUnit
              ? state.issueFlag ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]'
              : state.issueFlag ? 'text-[#A32D2D] opacity-70' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          {selectedUnit ? selectedUnit.title : 'Unit'}
        </span>
        <span
          className={cn(
            'text-[8px] opacity-60 flex-shrink-0',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          ›
        </span>
        <select
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px]"
          value={state.unitId ?? ''}
          onChange={(e) => onUnitChange(e.target.value)}
        >
          <option value="">— select unit —</option>
          {units.map((u) => (
            <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
          ))}
        </select>
      </div>

      {/* Lesson picker */}
      <div
        className="relative flex items-center h-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={cn(
            'flex-1 min-w-0 text-[11px] truncate pr-0.5',
            !state.unitId
              ? 'text-[var(--color-text-tertiary)] opacity-50'
              : selectedLesson
              ? state.issueFlag ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]'
              : state.issueFlag ? 'text-[#A32D2D] opacity-70' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          {selectedLesson ? selectedLesson.title : 'Lesson'}
        </span>
        <span
          className={cn(
            'text-[8px] flex-shrink-0',
            !state.unitId ? 'opacity-25' : 'opacity-60',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          ›
        </span>
        <select
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px] disabled:cursor-not-allowed"
          value={state.lessonId ?? ''}
          disabled={!state.unitId}
          onChange={(e) => onLessonChange(e.target.value)}
        >
          <option value="">— select lesson —</option>
          {lessons.map((l) => (
            <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <hr
        className={cn(
          'border-none border-t mt-0.5',
          state.issueFlag
            ? 'border-t-[rgba(162,45,45,0.2)]'
            : 'border-t-[var(--color-border-tertiary)]',
        )}
        style={{ borderTopWidth: '0.5px' }}
      />

      {/* Icon row */}
      <div
        className="flex items-center gap-0.5 mt-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={cn(
            'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] transition-opacity',
            state.feedbackVisible
              ? 'opacity-100 text-[#1D9E75]'
              : state.issueFlag
              ? 'text-[#A32D2D] opacity-50 hover:opacity-100'
              : 'text-[var(--color-text-tertiary)] opacity-50 hover:opacity-100',
          )}
          onClick={onFeedbackToggle}
          title="Toggle feedback visible"
        >
          ✓
        </button>
        <button
          type="button"
          className={cn(
            'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] font-medium opacity-20 cursor-default',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
          disabled
          title="Grades page (not configured)"
        >
          %
        </button>
        <button
          type="button"
          className={cn(
            'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] opacity-20 cursor-default',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
          disabled
          title="Slide deck (not configured)"
        >
          ▶
        </button>
      </div>
    </div>
  )
}
