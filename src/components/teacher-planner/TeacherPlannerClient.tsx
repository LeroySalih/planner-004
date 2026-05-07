'use client'

import { useState, useCallback } from 'react'
import { readLessonsByUnitAction } from '@/lib/server-updates'
import { PlannerGrid } from './PlannerGrid'
import { SidePanel } from './SidePanel'
import { WeekNotes } from './WeekNotes'
import { TIMETABLE_SLOTS } from './timetable-config'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day } from './types'
import type { Unit, Group, LessonWithObjectives } from '@/types'

type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
}

export function TeacherPlannerClient({ units, groups }: TeacherPlannerClientProps) {
  const [plannerState, setPlannerState] = useState<PlannerState>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [weekNotes, setWeekNotes] = useState('')
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())

  const handleCellClick = useCallback((day: Day, period: number) => {
    const key = slotKey(day, period)
    setSelectedSlot((prev) => (prev === key ? null : key))
  }, [])

  const handleUnitChange = useCallback(async (day: Day, period: number, unitId: string) => {
    const key = slotKey(day, period)
    setPlannerState((prev) => {
      const current = prev.get(key) ?? emptyCellState()
      const next = new Map(prev)
      next.set(key, { ...current, unitId: unitId || null, lessonId: null })
      return next
    })

    if (!unitId) return

    const result = await readLessonsByUnitAction(unitId)
    if (result.data) {
      setLessonCache((prev) => {
        if (prev.has(unitId)) return prev  // already cached (race condition guard)
        const next = new Map(prev)
        next.set(unitId, result.data!)
        return next
      })
    }
  }, [])

  const handleLessonChange = useCallback((day: Day, period: number, lessonId: string) => {
    const key = slotKey(day, period)
    setPlannerState((prev) => {
      const current = prev.get(key) ?? emptyCellState()
      const next = new Map(prev)
      next.set(key, { ...current, lessonId: lessonId || null })
      return next
    })
  }, [])

  const handleFeedbackToggle = useCallback((day: Day, period: number) => {
    const key = slotKey(day, period)
    setPlannerState((prev) => {
      const current = prev.get(key) ?? emptyCellState()
      const next = new Map(prev)
      next.set(key, { ...current, feedbackVisible: !current.feedbackVisible })
      return next
    })
  }, [])

  const handleIssueToggle = useCallback((day: Day, period: number) => {
    const key = slotKey(day, period)
    setPlannerState((prev) => {
      const current = prev.get(key) ?? emptyCellState()
      const next = new Map(prev)
      next.set(key, {
        ...current,
        issueFlag: !current.issueFlag,
        issueNote: current.issueFlag ? '' : current.issueNote,
      })
      return next
    })
  }, [])

  const handleIssueNoteChange = useCallback((day: Day, period: number, note: string) => {
    const key = slotKey(day, period)
    setPlannerState((prev) => {
      const current = prev.get(key) ?? emptyCellState()
      const next = new Map(prev)
      next.set(key, { ...current, issueNote: note })
      return next
    })
  }, [])

  const handleLessonNotesChange = useCallback((day: Day, period: number, notes: string) => {
    const key = slotKey(day, period)
    setPlannerState((prev) => {
      const current = prev.get(key) ?? emptyCellState()
      const next = new Map(prev)
      next.set(key, { ...current, lessonNotes: notes })
      return next
    })
  }, [])

  // Derive selected slot info for SidePanel
  const selectedParsed = selectedSlot ? (() => {
    const idx = selectedSlot.lastIndexOf('-')
    return {
      day: selectedSlot.slice(0, idx) as Day,
      period: Number(selectedSlot.slice(idx + 1)),
    }
  })() : null

  const selectedCellState = selectedSlot ? (plannerState.get(selectedSlot) ?? emptyCellState()) : null
  const selectedTimetableSlot = selectedParsed
    ? TIMETABLE_SLOTS.find((s) => s.day === selectedParsed.day && s.period === selectedParsed.period) ?? null
    : null

  return (
    <div className="relative max-w-[760px] mx-auto rounded-[12px] bg-[var(--color-background-tertiary)] p-4">
      <PlannerGrid
        units={units}
        plannerState={plannerState}
        selectedSlot={selectedSlot}
        lessonCache={lessonCache}
        onCellClick={handleCellClick}
        onUnitChange={handleUnitChange}
        onLessonChange={handleLessonChange}
        onFeedbackToggle={handleFeedbackToggle}
      />

      <SidePanel
        day={selectedParsed?.day ?? null}
        period={selectedParsed?.period ?? null}
        cellState={selectedCellState}
        slot={selectedTimetableSlot}
        units={units}
        lessonCache={lessonCache}
        groups={groups}
        onClose={() => setSelectedSlot(null)}
        onIssueToggle={handleIssueToggle}
        onIssueNoteChange={handleIssueNoteChange}
        onLessonNotesChange={handleLessonNotesChange}
      />

      <WeekNotes value={weekNotes} onChange={setWeekNotes} />
    </div>
  )
}
