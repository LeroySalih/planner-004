'use client'

import { useState } from 'react'
import { addSowLessonAction, removeSowLessonAction } from '@/lib/server-updates'
import { SowLessonPicker } from './SowLessonPicker'
import { toast } from 'sonner'
import type { SowLessonPlan, Unit } from '@/types'

type Props = {
  groupId: string
  weekStartDate: string
  weekLabel: string
  halfTermBadge: string
  isHoliday: boolean
  lessons: SowLessonPlan[]
  units: Unit[]
  lessonTitleMap: Map<string, string>
  onLessonsChange: (weekStartDate: string, lessons: SowLessonPlan[]) => void
}

const BADGE_COLOURS: Record<string, string> = {
  H1: 'bg-blue-100 text-blue-700',
  H2: 'bg-green-100 text-green-700',
  H3: 'bg-yellow-100 text-yellow-700',
  H4: 'bg-orange-100 text-orange-700',
  H5: 'bg-purple-100 text-purple-700',
  H6: 'bg-pink-100 text-pink-700',
}

export function SowWeekRow({
  groupId,
  weekStartDate,
  weekLabel,
  halfTermBadge,
  isHoliday,
  lessons,
  units,
  lessonTitleMap,
  onLessonsChange,
}: Props) {
  const [showPicker, setShowPicker] = useState(false)

  async function handleAdd(lessonId: string, unitId: string) {
    if (lessons.some((l) => l.lesson_id === lessonId)) return
    const { error } = await addSowLessonAction(groupId, lessonId, unitId, weekStartDate)
    if (error) { toast.error('Failed to add lesson'); return }
    const newLesson: SowLessonPlan = {
      id: crypto.randomUUID(),
      group_id: groupId,
      lesson_id: lessonId,
      unit_id: unitId,
      week_start_date: weekStartDate,
      created_at: new Date().toISOString(),
    }
    onLessonsChange(weekStartDate, [...lessons, newLesson])
    setShowPicker(false)
  }

  async function handleRemove(lessonId: string) {
    const { error } = await removeSowLessonAction(groupId, lessonId, weekStartDate)
    if (error) { toast.error('Failed to remove lesson'); return }
    onLessonsChange(weekStartDate, lessons.filter((l) => l.lesson_id !== lessonId))
  }

  if (isHoliday) {
    return (
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg opacity-40 text-sm">
        <span className="w-8 text-center text-xs font-medium text-[var(--color-text-tertiary)]">—</span>
        <span className="text-[var(--color-text-tertiary)]">{weekLabel} · Holiday</span>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-[var(--color-background-secondary)] group">
      <span
        className={`mt-0.5 w-8 shrink-0 rounded text-center text-xs font-semibold px-1 py-0.5 ${BADGE_COLOURS[halfTermBadge] ?? ''}`}
      >
        {halfTermBadge}
      </span>

      <div className="flex-1">
        <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">{weekLabel}</p>
        <ul className="flex flex-col gap-0.5">
          {lessons.map((l) => (
            <li key={l.lesson_id} className="flex items-center gap-1 text-sm text-[var(--color-text-primary)]">
              <span>• {lessonTitleMap.get(l.lesson_id) ?? l.lesson_id}</span>
              <button
                onClick={() => handleRemove(l.lesson_id)}
                className="opacity-0 group-hover:opacity-100 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-xs"
                aria-label="Remove lesson"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        {showPicker ? (
          <SowLessonPicker
            units={units}
            onSelect={(lessonId, unitId) => handleAdd(lessonId, unitId)}
            onCancel={() => setShowPicker(false)}
          />
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] mt-1 opacity-0 group-hover:opacity-100"
          >
            + Add lesson
          </button>
        )}
      </div>
    </div>
  )
}
