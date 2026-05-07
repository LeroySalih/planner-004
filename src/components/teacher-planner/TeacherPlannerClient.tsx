'use client'

import { useState, useCallback } from 'react'
import { readLessonsByUnitAction } from '@/lib/server-updates'
import { PlannerGrid } from './PlannerGrid'
import { SidePanel } from './SidePanel'
import { WeekNotes } from './WeekNotes'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day, CellState } from './types'
import type { Unit, Group, Lesson } from '@/types'

type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
}

export function TeacherPlannerClient({ units, groups }: TeacherPlannerClientProps) {
  const [plannerState, setPlannerState] = useState<PlannerState>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [weekNotes, setWeekNotes] = useState('')
  const [lessonCache, setLessonCache] = useState<Map<string, Lesson[]>>(new Map())

  function getCellState(day: Day, period: number): CellState {
    return plannerState.get(slotKey(day, period)) ?? emptyCellState()
  }

  function updateCellState(day: Day, period: number, patch: Partial<CellState>) {
    const key = slotKey(day, period)
    setPlannerState((prev) => {
      const next = new Map(prev)
      next.set(key, { ...(prev.get(key) ?? emptyCellState()), ...patch })
      return next
    })
  }

  const handleCellClick = useCallback((day: Day, period: number) => {
    const key = slotKey(day, period)
    setSelectedSlot((prev) => (prev === key ? null : key))
  }, [])

  const handleUnitChange = useCallback(async (day: Day, period: number, unitId: string) => {
    updateCellState(day, period, { unitId: unitId || null, lessonId: null })

    if (!unitId) return
    if (lessonCache.has(unitId)) return

    const result = await readLessonsByUnitAction(unitId)
    if (result.data) {
      setLessonCache((prev) => {
        const next = new Map(prev)
        next.set(unitId, result.data as Lesson[])
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonCache])

  const handleLessonChange = useCallback((day: Day, period: number, lessonId: string) => {
    updateCellState(day, period, { lessonId: lessonId || null })
  }, [])

  const handleFeedbackToggle = useCallback((day: Day, period: number) => {
    const current = getCellState(day, period)
    updateCellState(day, period, { feedbackVisible: !current.feedbackVisible })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerState])

  const handleIssueToggle = useCallback((day: Day, period: number) => {
    const current = getCellState(day, period)
    updateCellState(day, period, {
      issueFlag: !current.issueFlag,
      issueNote: current.issueFlag ? '' : current.issueNote,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerState])

  const handleIssueNoteChange = useCallback((day: Day, period: number, note: string) => {
    updateCellState(day, period, { issueNote: note })
  }, [])

  const handleLessonNotesChange = useCallback((day: Day, period: number, notes: string) => {
    updateCellState(day, period, { lessonNotes: notes })
  }, [])

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
        selectedSlot={selectedSlot}
        plannerState={plannerState}
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
