'use client'

import { useState } from 'react'
import type { CellState, SlotLesson, Day, TimetableSlot } from './types'
import type { Unit, Group, LessonWithObjectives } from '@/types'

type SidePanelProps = {
  day: Day | null
  period: number | null
  cellState: CellState | null
  slot: TimetableSlot | null
  units: Unit[]
  lessonCache: Map<string, LessonWithObjectives[]>
  groups: Group[]
  onClose: () => void
  onGroupChange: (day: Day, period: number, groupId: string) => void
  onUnitSelect: (unitId: string) => void
  onAddLesson: (day: Day, period: number, lessonId: string) => void
  onRemoveLesson: (day: Day, period: number, lessonId: string) => void
  onFeedbackToggle: (day: Day, period: number, lessonId: string) => void
  onIssueToggle: (day: Day, period: number, lessonId: string) => void
  onIssueNoteChange: (day: Day, period: number, lessonId: string, note: string) => void
  onLessonNotesChange: (day: Day, period: number, lessonId: string, notes: string) => void
}

export function SidePanel({
  day,
  period,
  cellState,
  slot,
  units,
  lessonCache,
  groups,
  onClose,
  onGroupChange,
  onUnitSelect,
  onAddLesson,
  onRemoveLesson,
  onFeedbackToggle,
  onIssueToggle,
  onIssueNoteChange,
  onLessonNotesChange,
}: SidePanelProps) {
  const [addUnitId, setAddUnitId] = useState('')
  const [addLessonId, setAddLessonId] = useState('')

  if (!day || period === null || !cellState) return null

  const { groupId, lessons } = cellState
  const hasGroup = !!groupId && groupId !== '__free__'

  const handleGroupChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onGroupChange(day, period, e.target.value)
  }

  const handleAddUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uid = e.target.value
    setAddUnitId(uid)
    setAddLessonId('')
    onUnitSelect(uid)
  }

  const handleAddLesson = () => {
    if (!addLessonId) return
    onAddLesson(day, period, addLessonId)
    setAddUnitId('')
    setAddLessonId('')
  }

  const addUnitLessons = lessonCache.get(addUnitId) ?? []

  return (
    <div className="fixed right-0 top-[80px] h-[calc(100vh-80px)] w-[320px] bg-[var(--color-background-primary)] border-l border-[var(--color-border-tertiary)] p-5 overflow-y-auto z-40 flex flex-col gap-3.5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[14px] m-0">
          {`Period ${period}`}{slot?.startTime ? ` · ${slot.startTime}` : ''}
        </h3>
        <button
          type="button"
          className="text-[16px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] bg-transparent border-none cursor-pointer p-0 leading-none"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Group selector */}
      <div className="mb-4">
        <label className="text-xs text-[var(--color-text-secondary)] block mb-1">Class</label>
        <select
          className="w-full text-sm rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1.5"
          value={groupId ?? ''}
          onChange={handleGroupChange}
        >
          <option value="">No class</option>
          <option value="__free__">Free period</option>
          {groups.map((g) => (
            <option key={g.group_id} value={g.group_id}>{g.group_id}</option>
          ))}
        </select>
      </div>

      {/* Lesson cards */}
      {hasGroup && lessons.length > 0 && (
        <div className="flex flex-col gap-3 mb-4">
          {lessons.map((lesson) => (
            <LessonCard
              key={lesson.lessonId}
              lesson={lesson}
              day={day}
              period={period}
              onFeedbackToggle={onFeedbackToggle}
              onIssueToggle={onIssueToggle}
              onIssueNoteChange={onIssueNoteChange}
              onLessonNotesChange={onLessonNotesChange}
              onRemove={onRemoveLesson}
            />
          ))}
        </div>
      )}

      {/* Add lesson section */}
      {hasGroup && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">Add lesson</p>
          <div className="flex flex-col gap-2">
            <select
              className="w-full text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1"
              value={addUnitId}
              onChange={handleAddUnitChange}
            >
              <option value="">Unit…</option>
              {units.map((u) => (
                <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
              ))}
            </select>
            {addUnitId && (
              <>
                <select
                  className="w-full text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1"
                  value={addLessonId}
                  onChange={(e) => setAddLessonId(e.target.value)}
                >
                  <option value="">Lesson…</option>
                  {addUnitLessons.map((l) => (
                    <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
                  ))}
                </select>
                <button
                  className="text-xs px-3 py-1 rounded bg-[var(--color-primary)] text-white disabled:opacity-40"
                  disabled={!addLessonId}
                  onClick={handleAddLesson}
                >
                  Add
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

type LessonCardProps = {
  lesson: SlotLesson
  day: Day
  period: number
  onFeedbackToggle: (day: Day, period: number, lessonId: string) => void
  onIssueToggle: (day: Day, period: number, lessonId: string) => void
  onIssueNoteChange: (day: Day, period: number, lessonId: string, note: string) => void
  onLessonNotesChange: (day: Day, period: number, lessonId: string, notes: string) => void
  onRemove: (day: Day, period: number, lessonId: string) => void
}

function LessonCard({
  lesson,
  day,
  period,
  onFeedbackToggle,
  onIssueToggle,
  onIssueNoteChange,
  onLessonNotesChange,
  onRemove,
}: LessonCardProps) {
  return (
    <div className="rounded-[8px] bg-[var(--color-background-primary)] p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-medium leading-tight flex-1">{lesson.lessonTitle}</p>
        <button
          className="text-[10px] text-[var(--color-text-tertiary)] hover:text-red-500 shrink-0"
          onClick={() => onRemove(day, period, lesson.lessonId)}
        >
          Remove
        </button>
      </div>

      {/* Toggles row */}
      <div className="flex gap-2 mb-2">
        <button
          className={`text-[10px] px-2 py-0.5 rounded ${
            lesson.feedbackVisible
              ? 'bg-green-500 text-white'
              : 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]'
          }`}
          onClick={() => onFeedbackToggle(day, period, lesson.lessonId)}
        >
          Feedback {lesson.feedbackVisible ? 'on' : 'off'}
        </button>
        <button
          className={`text-[10px] px-2 py-0.5 rounded ${
            lesson.issueFlag
              ? 'bg-red-500 text-white'
              : 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]'
          }`}
          onClick={() => onIssueToggle(day, period, lesson.lessonId)}
        >
          {lesson.issueFlag ? '⚠ Issue' : 'No issue'}
        </button>
      </div>

      {/* Issue note */}
      {lesson.issueFlag && (
        <textarea
          className="w-full text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1 mb-2 resize-none"
          rows={2}
          placeholder="Issue note…"
          value={lesson.issueNote}
          onChange={(e) => onIssueNoteChange(day, period, lesson.lessonId, e.target.value)}
        />
      )}

      {/* Lesson notes */}
      <textarea
        className="w-full text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1 resize-none"
        rows={2}
        placeholder="Lesson notes…"
        value={lesson.lessonNotes}
        onChange={(e) => onLessonNotesChange(day, period, lesson.lessonId, e.target.value)}
      />
    </div>
  )
}
