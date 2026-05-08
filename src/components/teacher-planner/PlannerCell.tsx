'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { CellState, Day } from './types'
import type { Unit, LessonWithObjectives } from '@/types'

type PlannerCellProps = {
  day: Day
  period: number
  cellState: CellState
  units: Unit[]
  lessonCache: Map<string, LessonWithObjectives[]>
  isSelected: boolean
  onCellClick: (day: Day, period: number) => void
  onUnitSelect: (unitId: string) => void
  onLessonChange: (day: Day, period: number, lessonId: string) => void
  onFeedbackToggle: (day: Day, period: number, lessonId: string) => void
}

export function PlannerCell({
  day,
  period,
  cellState,
  units,
  lessonCache,
  isSelected,
  onCellClick,
  onUnitSelect,
  onLessonChange,
  onFeedbackToggle,
}: PlannerCellProps) {
  const [pendingUnitId, setPendingUnitId] = useState<string>('')

  const { groupId, lessons, issueFlag, issueNote: _issueNote } = cellState
  const hasGroup = !!groupId && groupId !== '__free__'
  const lessonCount = lessons.length

  // Period-level indicators
  const anyFeedback = lessons.some((l) => l.feedbackVisible)
  const anyIssue = issueFlag

  const currentLesson = lessons[0] ?? null
  const currentUnitId = currentLesson?.unitId ?? ''
  const currentUnitLessons = lessonCache.get(currentUnitId) ?? []
  const availableLessons = lessonCache.get(pendingUnitId) ?? []

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uid = e.target.value
    setPendingUnitId(uid)
    onUnitSelect(uid)
  }

  const handleLessonSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onLessonChange(day, period, e.target.value)
  }

  return (
    <div
      className={cn(
        'relative flex flex-col gap-[3px] rounded-[8px] border px-[7px] py-[6px] min-h-[86px] cursor-pointer transition-colors',
        anyIssue
          ? 'bg-[#FCEBEB] border-[#F09595] hover:border-[#E24B4A]'
          : 'bg-[var(--color-background-primary)] border-[var(--color-border-tertiary)] hover:border-[var(--color-border-secondary)]',
        isSelected && !anyIssue && 'border-[1.5px] border-[var(--color-border-info)]',
        isSelected && anyIssue && 'border-[1.5px] border-[#E24B4A]',
      )}
      onClick={() => onCellClick(day, period)}
    >
      {/* Class label */}
      {hasGroup && (
        <p className={cn(
          'font-medium text-[12px] mb-0.5 truncate',
          anyIssue ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]',
        )}>
          {groupId}
        </p>
      )}

      {!hasGroup && (
        <span className="text-xs text-[var(--color-text-tertiary)]">Free period</span>
      )}

      {/* 0 lessons — unit + lesson pickers */}
      {hasGroup && lessonCount === 0 && (
        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
          <select
            className="text-xs w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-1 py-0.5"
            value={pendingUnitId}
            onChange={handleUnitChange}
          >
            <option value="">Unit…</option>
            {units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
            ))}
          </select>
          {pendingUnitId && (
            <select
              className="text-xs w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-1 py-0.5"
              value=""
              onChange={handleLessonSelect}
            >
              <option value="">Lesson…</option>
              {availableLessons.map((l) => (
                <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* 1 lesson — title + swap dropdown */}
      {hasGroup && lessonCount === 1 && (
        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
          <span className={cn(
            'text-[11px] truncate',
            anyIssue ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]',
          )}>
            {currentLesson!.lessonTitle}
          </span>
          <select
            className="text-xs w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-1 py-0.5"
            value={currentLesson!.lessonId}
            onChange={handleLessonSelect}
          >
            {currentUnitLessons.length === 0 && (
              <option value={currentLesson!.lessonId}>{currentLesson!.lessonTitle}</option>
            )}
            {currentUnitLessons.map((l) => (
              <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
            ))}
          </select>
        </div>
      )}

      {/* 2+ lessons */}
      {hasGroup && lessonCount >= 2 && (
        <span className={cn(
          'text-[11px]',
          anyIssue ? 'text-[#791F1F]' : 'text-[var(--color-text-secondary)]',
        )}>
          Lesson plan ({lessonCount})
        </span>
      )}

      {/* Icon row — shown when a group + at least one lesson assigned */}
      {hasGroup && lessonCount > 0 && (
        <>
          <hr
            className={cn(
              'border-none mt-auto',
              anyIssue ? 'border-t-[rgba(162,45,45,0.2)]' : 'border-t-[var(--color-border-tertiary)]',
            )}
            style={{ borderTopWidth: '0.5px' }}
          />
          <div
            className="flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Feedback toggle */}
            <button
              type="button"
              className={cn(
                'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] transition-opacity',
                anyFeedback
                  ? 'opacity-100 text-[#1D9E75]'
                  : anyIssue
                  ? 'text-[#A32D2D] opacity-50 hover:opacity-100'
                  : 'text-[var(--color-text-tertiary)] opacity-50 hover:opacity-100',
              )}
              onClick={() => currentLesson && onFeedbackToggle(day, period, currentLesson.lessonId)}
              title="Toggle feedback visible"
            >
              ✓
            </button>
            {/* Grades — links to feedback page if a lesson is assigned */}
            {currentLesson && groupId ? (
              <Link
                href={`/feedback/groups/${groupId}/lessons/${currentLesson.lessonId}`}
                className={cn(
                  'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] text-[9px] font-medium opacity-60 hover:opacity-100 transition-opacity',
                  anyIssue ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
                )}
                title="View grades / feedback"
                onClick={(e) => e.stopPropagation()}
              >
                %
              </Link>
            ) : (
              <span
                className={cn(
                  'w-[16px] h-[16px] flex items-center justify-center text-[9px] font-medium opacity-20',
                  anyIssue ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
                )}
              >
                %
              </span>
            )}
            {/* Slide deck placeholder */}
            <button
              type="button"
              className={cn(
                'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] opacity-20 cursor-default',
                anyIssue ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
              )}
              disabled
              title="Slide deck (not configured)"
            >
              ▶
            </button>
            {/* Issue indicator */}
            {anyIssue && (
              <span className="ml-auto text-[9px] text-[#A32D2D] font-medium">⚠</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
