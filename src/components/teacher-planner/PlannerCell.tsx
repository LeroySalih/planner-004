'use client'

import { useState } from 'react'
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

  const { groupId, lessons } = cellState
  const hasGroup = !!groupId && groupId !== '__free__'
  const lessonCount = lessons.length

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uid = e.target.value
    setPendingUnitId(uid)
    onUnitSelect(uid)
  }

  const handleLessonSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onLessonChange(day, period, e.target.value)
  }

  const handleFeedback = (lessonId: string) => {
    onFeedbackToggle(day, period, lessonId)
  }

  const availableLessons = lessonCache.get(pendingUnitId) ?? []
  const currentLesson = lessons[0] ?? null

  // Determine what unit is currently selected for the 1-lesson state
  const currentUnitId = currentLesson?.unitId ?? ''
  const currentUnitLessons = lessonCache.get(currentUnitId) ?? []

  return (
    <div
      className={`relative p-2 rounded-[8px] min-h-[80px] cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[var(--color-background-secondary)] ring-2 ring-[var(--color-primary)]'
          : 'bg-[var(--color-background-primary)] hover:bg-[var(--color-background-secondary)]'
      }`}
      onClick={() => onCellClick(day, period)}
    >
      {/* Class label — always shown when a group is assigned */}
      {hasGroup && (
        <p className="text-[10px] font-semibold text-[var(--color-text-secondary)] mb-1 truncate">
          {groupId}
        </p>
      )}

      {!hasGroup && (
        <span className="text-xs text-[var(--color-text-tertiary)]">Free period</span>
      )}

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

      {hasGroup && lessonCount === 1 && (
        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium truncate flex-1">{currentLesson!.lessonTitle}</span>
            <button
              className={`text-[10px] px-1 py-0.5 rounded ${
                currentLesson!.feedbackVisible
                  ? 'bg-green-500 text-white'
                  : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]'
              }`}
              onClick={() => handleFeedback(currentLesson!.lessonId)}
            >
              FB
            </button>
          </div>
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

      {hasGroup && lessonCount >= 2 && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium">Lesson plan ({lessonCount})</span>
        </div>
      )}
    </div>
  )
}
