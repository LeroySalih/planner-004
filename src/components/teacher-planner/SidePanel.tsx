'use client'

import { cn } from '@/lib/utils'
import { DAY_LABELS, PERIOD_LAYOUT } from './timetable-config'
import type { Day, CellState, TimetableSlot } from './types'
import type { Unit, LessonWithObjectives, Group } from '@/types'

type SidePanelProps = {
  day: Day | null
  period: number | null
  cellState: CellState | null
  slot: TimetableSlot | null
  units: Unit[]
  lessonCache: Map<string, LessonWithObjectives[]>
  groups: Group[]
  onClose: () => void
  onIssueToggle: (day: Day, period: number) => void
  onIssueNoteChange: (day: Day, period: number, note: string) => void
  onLessonNotesChange: (day: Day, period: number, notes: string) => void
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
  onIssueToggle,
  onIssueNoteChange,
  onLessonNotesChange,
}: SidePanelProps) {
  if (!day || !period || !cellState || !slot) return null

  const selectedUnit = units.find((u) => u.unit_id === cellState.unitId) ?? null
  const lessons = lessonCache.get(cellState.unitId ?? '') ?? []
  const selectedLesson: LessonWithObjectives | null = lessons.find((l) => l.lesson_id === cellState.lessonId) ?? null
  const group = groups.find((g) => g.subject === slot.classCode) ?? null

  const periodRow = PERIOD_LAYOUT.find(
    (r) => r.type === 'lesson' && r.period === period,
  )
  const periodLabel = periodRow?.type === 'lesson' ? periodRow.label : `L${period}`

  const objectives = selectedLesson?.lesson_objectives
    ?.map((lo) => lo.title)
    .join('. ')

  return (
    <>
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/[0.18] z-[5] rounded-[12px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute top-0 right-0 w-[320px] h-full bg-[var(--color-background-primary)] border-l border-[var(--color-border-tertiary)] rounded-r-[12px] p-5 overflow-y-auto z-[6] flex flex-col gap-3.5">

        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className="font-medium text-[15px] text-[var(--color-text-primary)] m-0">
              {slot.classCode} · {slot.subject}
            </h2>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5 m-0">
              {DAY_LABELS[day]} · {periodLabel}
            </p>
          </div>
          <button
            type="button"
            className="text-[16px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] bg-transparent border-none cursor-pointer p-0 leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <hr style={{ borderTopWidth: '0.5px' }} className="border-none border-t border-[var(--color-border-tertiary)]" />

        {/* Details */}
        <div>
          <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1.5 m-0">Details</p>
          <div className="flex flex-col">
            {[
              { key: 'Unit',   val: selectedUnit?.title ?? '—' },
              { key: 'Lesson', val: selectedLesson?.title ?? '—' },
              { key: 'Room',   val: slot.room || '—' },
              { key: 'Pupils', val: group?.member_count != null ? String(group.member_count) : '—' },
            ].map(({ key, val }) => (
              <div
                key={key}
                className="flex justify-between py-[5px] border-b text-[12px]"
                style={{ borderBottomWidth: '0.5px', borderColor: 'var(--color-border-tertiary)' }}
              >
                <span className="text-[var(--color-text-secondary)]">{key}</span>
                <span className="font-medium text-[var(--color-text-primary)]">{val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Previous lesson */}
        <div>
          <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1.5 m-0">Previous lesson</p>
          <div className="bg-[var(--color-background-secondary)] rounded-[8px] p-2.5 text-[12px] text-[var(--color-text-secondary)] italic">
            No previous lesson recorded
          </div>
        </div>

        {/* Issue */}
        <div>
          <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1.5 m-0">Issue</p>
          <div
            className={cn(
              'flex justify-between items-center px-2.5 py-2 rounded-[8px] border text-[12px] cursor-pointer select-none',
              cellState.issueFlag
                ? 'bg-[#FCEBEB] border-[#F09595] text-[#791F1F]'
                : 'border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]',
            )}
            onClick={() => onIssueToggle(day, period)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onIssueToggle(day, period) }}
          >
            <span>Flag this lesson</span>
            <div
              className={cn(
                'w-7 h-4 rounded-full relative flex-shrink-0 transition-colors',
                cellState.issueFlag ? 'bg-[#E24B4A]' : 'bg-[var(--color-border-secondary)]',
              )}
            >
              <div
                className={cn(
                  'w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left] duration-150',
                  cellState.issueFlag ? 'left-[14px]' : 'left-0.5',
                )}
              />
            </div>
          </div>
          {cellState.issueFlag && (
            <textarea
              className="mt-1.5 w-full text-[12px] bg-[var(--color-background-secondary)] border border-[#F09595] rounded-[8px] px-2.5 py-2 resize-y min-h-[56px] text-[#791F1F] focus:outline-none focus:border-[#E24B4A] box-border"
              placeholder="Describe the issue…"
              value={cellState.issueNote}
              onChange={(e) => onIssueNoteChange(day, period, e.target.value)}
            />
          )}
        </div>

        {/* Objectives */}
        <div>
          <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1.5 m-0">Objectives</p>
          <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed m-0">
            {objectives || (selectedLesson ? 'No objectives recorded for this lesson.' : 'Select a lesson to see objectives.')}
          </p>
        </div>

        {/* Lesson notes */}
        <div>
          <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1.5 m-0">Lesson notes</p>
          <textarea
            className="w-full text-[12px] bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)] rounded-[8px] px-2.5 py-2 resize-y min-h-[56px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-info)] box-border"
            placeholder="Differentiation, starters, exit tickets…"
            value={cellState.lessonNotes}
            onChange={(e) => onLessonNotesChange(day, period, e.target.value)}
          />
        </div>

      </div>
    </>
  )
}
