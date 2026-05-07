'use client'

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import {
  readLessonsByUnitAction,
  upsertPlannerAssignmentAction,
  deletePlannerAssignmentAction,
  readPlannerAssignmentsForWeekAction,
  updatePlannerAssignmentExtrasAction,
  upsertTimetableSlotGroupAction,
  readTimetableSlotGroupsAction,
} from '@/lib/server-updates'
import { PlannerGrid } from './PlannerGrid'
import { SidePanel } from './SidePanel'
import { WeekNavigator } from './WeekNavigator'
import { WeekNotes } from './WeekNotes'
import { TIMETABLE_SLOTS } from './timetable-config'
import { slotKey, emptyCellState, getTodaySunday, shiftWeek } from './types'
import type { WeeklyPlannerState, PlannerState, CellState, Day } from './types'
import type { Unit, Group, LessonWithObjectives } from '@/types'

type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
}

export function TeacherPlannerClient({ units, groups }: TeacherPlannerClientProps) {
  const [classOverrides, setClassOverrides] = useState<Map<string, string | null>>(new Map())
  const [weeklyStates, setWeeklyStates] = useState<WeeklyPlannerState>(new Map())
  const [currentWeek, setCurrentWeek] = useState<string>(getTodaySunday)
  const [weekNotes, setWeekNotesMap] = useState<Map<string, string>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())

  const currentWeekRef = useRef(currentWeek)
  currentWeekRef.current = currentWeek

  // Track which weeks have been fetched from DB to avoid redundant calls
  const loadedWeeks = useRef<Set<string>>(new Set())

  const loadWeekAssignments = useCallback(async (week: string) => {
    if (loadedWeeks.current.has(week)) return
    const { data, error } = await readPlannerAssignmentsForWeekAction(week)
    if (error || !data) {
      console.error('[loadWeekAssignments] Failed to load week:', week, error)
      return
    }
    loadedWeeks.current.add(week)
    setWeeklyStates((prev) => {
      const weekState = new Map(prev.get(week) ?? new Map())
      for (const pa of data) {
        const key = slotKey(pa.day as Day, pa.period)
        weekState.set(key, {
          unitId: pa.unit_id,
          lessonId: pa.lesson_id,
          groupId: pa.group_id,
          feedbackVisible: pa.feedback_visible,
          issueFlag: pa.issue_flag,
          issueNote: pa.issue_note,
          lessonNotes: pa.notes,
          assignmentId: pa.id,
        })
      }
      const next = new Map(prev)
      next.set(week, weekState)
      return next
    })
  }, [])

  // Hydrate on mount
  useEffect(() => {
    readTimetableSlotGroupsAction().then(({ data, error }) => {
      if (error || !data) {
        console.error('[hydration] Failed to load timetable slot groups:', error)
        return
      }
      const overrides = new Map<string, string | null>()
      for (const tsg of data) {
        overrides.set(slotKey(tsg.day as Day, tsg.period), tsg.group_id)
      }
      setClassOverrides(overrides)
    })
    loadWeekAssignments(getTodaySunday())
  }, [loadWeekAssignments])

  // Merge class overrides into the current week's state for display
  const rawWeekState = weeklyStates.get(currentWeek) ?? new Map<string, CellState>()
  const plannerState = useMemo<PlannerState>(() => {
    if (classOverrides.size === 0) return rawWeekState
    const merged = new Map(rawWeekState)
    for (const [key, groupId] of classOverrides) {
      const base = rawWeekState.get(key) ?? emptyCellState()
      merged.set(key, { ...base, groupId })
    }
    return merged
  }, [rawWeekState, classOverrides])

  const updateSlot = useCallback(
    (day: Day, period: number, update: (s: CellState) => CellState) => {
      const week = currentWeekRef.current
      const key = slotKey(day, period)
      setWeeklyStates((prev) => {
        const weekState = prev.get(week) ?? new Map()
        const current = weekState.get(key) ?? emptyCellState()
        const nextWeekState = new Map(weekState)
        nextWeekState.set(key, update(current))
        const next = new Map(prev)
        next.set(week, nextWeekState)
        return next
      })
    },
    [],
  )

  const handleCellClick = useCallback((day: Day, period: number) => {
    const key = slotKey(day, period)
    setSelectedSlot((prev) => (prev === key ? null : key))
  }, [])

  const handleUnitChange = useCallback(async (day: Day, period: number, unitId: string) => {
    updateSlot(day, period, (s) => ({ ...s, unitId: unitId || null, lessonId: null }))
    if (!unitId) return
    const result = await readLessonsByUnitAction(unitId)
    if (result.data) {
      setLessonCache((prev) => {
        if (prev.has(unitId)) return prev
        const next = new Map(prev)
        next.set(unitId, result.data!)
        return next
      })
    }
  }, [updateSlot])

  const handleLessonChange = useCallback(async (day: Day, period: number, lessonId: string) => {
    updateSlot(day, period, (s) => ({ ...s, lessonId: lessonId || null }))

    const week = currentWeekRef.current
    const key = slotKey(day, period)
    const cellState = plannerState.get(key) ?? emptyCellState()
    const groupId = cellState.groupId

    if (!lessonId) {
      if (groupId && groupId !== '__free__') {
        await deletePlannerAssignmentAction(groupId, week, day, period)
        updateSlot(day, period, (s) => ({ ...s, assignmentId: null }))
      }
      return
    }

    if (!groupId || groupId === '__free__') return

    const { data } = await upsertPlannerAssignmentAction(groupId, lessonId, week, day, period, {
      feedbackVisible: cellState.feedbackVisible,
      issueFlag: cellState.issueFlag,
      issueNote: cellState.issueNote,
      notes: cellState.lessonNotes,
    })
    if (data) {
      updateSlot(day, period, (s) => ({ ...s, assignmentId: data.id }))
    }
  }, [updateSlot, plannerState])

  const handleFeedbackToggle = useCallback(async (day: Day, period: number) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const next = !cell.feedbackVisible
    updateSlot(day, period, (s) => ({ ...s, feedbackVisible: next }))
    if (cell.assignmentId) {
      await updatePlannerAssignmentExtrasAction(cell.assignmentId, { feedback_visible: next })
    }
  }, [updateSlot, plannerState])

  const handleIssueToggle = useCallback(async (day: Day, period: number) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const nextFlag = !cell.issueFlag
    const nextNote = nextFlag ? cell.issueNote : ''
    updateSlot(day, period, (s) => ({ ...s, issueFlag: nextFlag, issueNote: nextNote }))
    if (cell.assignmentId) {
      await updatePlannerAssignmentExtrasAction(cell.assignmentId, {
        issue_flag: nextFlag,
        issue_note: nextNote,
      })
    }
  }, [updateSlot, plannerState])

  const handleIssueNoteChange = useCallback(async (day: Day, period: number, note: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    updateSlot(day, period, (s) => ({ ...s, issueNote: note }))
    if (cell.assignmentId) {
      await updatePlannerAssignmentExtrasAction(cell.assignmentId, { issue_note: note })
    }
  }, [updateSlot, plannerState])

  const handleLessonNotesChange = useCallback(async (day: Day, period: number, notes: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    updateSlot(day, period, (s) => ({ ...s, lessonNotes: notes }))
    if (cell.assignmentId) {
      await updatePlannerAssignmentExtrasAction(cell.assignmentId, { notes })
    }
  }, [updateSlot, plannerState])

  const handleGroupChange = useCallback(async (day: Day, period: number, groupId: string) => {
    const key = slotKey(day, period)
    const existing = plannerState.get(key)
    const resolvedGroupId = groupId || null
    // If changing to a different group (not free), delete the old group's assignment
    if (existing?.assignmentId && existing.groupId && existing.groupId !== groupId && groupId !== '__free__') {
      const week = currentWeekRef.current
      await deletePlannerAssignmentAction(existing.groupId, week, day, period)
      updateSlot(day, period, (s) => ({ ...s, assignmentId: null }))
    }
    // If a lesson was already selected, create a new assignment for the incoming group
    if (resolvedGroupId && resolvedGroupId !== '__free__' && existing?.lessonId) {
      const week = currentWeekRef.current
      const { data } = await upsertPlannerAssignmentAction(
        resolvedGroupId,
        existing.lessonId,
        week,
        day,
        period,
        {
          feedbackVisible: existing.feedbackVisible,
          issueFlag: existing.issueFlag,
          issueNote: existing.issueNote,
          notes: existing.lessonNotes,
        },
      )
      if (data) {
        updateSlot(day, period, (s) => ({ ...s, assignmentId: data.id }))
      }
    }
    setClassOverrides((prev) => {
      const next = new Map(prev)
      next.set(key, resolvedGroupId)
      return next
    })
    if (groupId === '__free__') {
      updateSlot(day, period, (s) => ({ ...s, unitId: null, lessonId: null, assignmentId: null }))
    }
    await upsertTimetableSlotGroupAction(day, period, resolvedGroupId)
  }, [updateSlot, plannerState])

  const handlePrevWeek = useCallback(() => {
    const next = shiftWeek(currentWeekRef.current, -1)
    setCurrentWeek(next)
    setSelectedSlot(null)
    loadWeekAssignments(next)
  }, [loadWeekAssignments])

  const handleNextWeek = useCallback(() => {
    const next = shiftWeek(currentWeekRef.current, 1)
    setCurrentWeek(next)
    setSelectedSlot(null)
    loadWeekAssignments(next)
  }, [loadWeekAssignments])

  const weekNote = weekNotes.get(currentWeek) ?? ''
  const handleWeekNoteChange = useCallback((value: string) => {
    setWeekNotesMap((prev) => {
      const next = new Map(prev)
      next.set(currentWeekRef.current, value)
      return next
    })
  }, [])

  const selectedParsed = selectedSlot
    ? (() => {
        const idx = selectedSlot.lastIndexOf('-')
        return {
          day: selectedSlot.slice(0, idx) as Day,
          period: Number(selectedSlot.slice(idx + 1)),
        }
      })()
    : null

  const selectedCellState = selectedSlot
    ? (plannerState.get(selectedSlot) ?? emptyCellState())
    : null
  const selectedTimetableSlot = selectedParsed
    ? TIMETABLE_SLOTS.find(
        (s) => s.day === selectedParsed.day && s.period === selectedParsed.period,
      ) ?? null
    : null

  return (
    <div className="max-w-[1200px] mx-auto rounded-[12px] bg-[var(--color-background-tertiary)] p-4">
      <WeekNavigator
        currentWeek={currentWeek}
        onPrev={handlePrevWeek}
        onNext={handleNextWeek}
      />

      <PlannerGrid
        units={units}
        groups={groups}
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
        onGroupChange={handleGroupChange}
        onIssueToggle={handleIssueToggle}
        onIssueNoteChange={handleIssueNoteChange}
        onLessonNotesChange={handleLessonNotesChange}
      />

      <WeekNotes value={weekNote} onChange={handleWeekNoteChange} />
    </div>
  )
}
