'use client'

import { useState } from 'react'
import type { Unit, LessonWithObjectives } from '@/types'
import { readLessonsByUnitAction } from '@/lib/server-updates'
import { toast } from 'sonner'

type Props = {
  units: Unit[]
  onSelect: (lessonId: string, unitId: string) => void
  onCancel: () => void
}

export function SowLessonPicker({ units, onSelect, onCancel }: Props) {
  const [selectedUnitId, setSelectedUnitId] = useState<string>('')
  const [lessons, setLessons] = useState<LessonWithObjectives[]>([])
  const [loading, setLoading] = useState(false)

  async function handleUnitChange(unitId: string) {
    setSelectedUnitId(unitId)
    if (!unitId) { setLessons([]); return }
    setLoading(true)
    const { data, error } = await readLessonsByUnitAction(unitId)
    if (error) {
      toast.error('Failed to load lessons')
      setLoading(false)
      return
    }
    setLessons(data ?? [])
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-2 mt-2">
      <select
        value={selectedUnitId}
        onChange={(e) => handleUnitChange(e.target.value)}
        className="text-sm rounded border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1"
      >
        <option value="">Select unit…</option>
        {units.map((u) => (
          <option key={u.unit_id} value={u.unit_id}>{u.subject}</option>
        ))}
      </select>

      {loading && <p className="text-xs text-[var(--color-text-tertiary)]">Loading…</p>}

      {!loading && lessons.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
          {lessons.map((l) => (
            <button
              key={l.lesson_id}
              onClick={() => onSelect(l.lesson_id, selectedUnitId)}
              className="text-left text-xs px-2 py-1 rounded hover:bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]"
            >
              {l.title}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onCancel}
        className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-left"
      >
        Cancel
      </button>
    </div>
  )
}
