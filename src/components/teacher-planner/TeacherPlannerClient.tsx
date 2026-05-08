'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  readLessonsByUnitAction,
  upsertPlannerAssignmentAction,
  deletePlannerAssignmentAction,
  readPlannerAssignmentsForWeekAction,
  updatePlannerAssignmentExtrasAction,
  readTimetableSlotGroupsAction,
  upsertTimetableSlotGroupAction,
} from '@/lib/server-updates'
import { PlannerGrid } from './PlannerGrid'
import { SidePanel } from './SidePanel'
import { WeekNavigator } from './WeekNavigator'
import { WeekNotes } from './WeekNotes'
import { TIMETABLE_SLOTS } from './timetable-config'
import { slotKey, emptyCellState, getTodaySunday, shiftWeek } from './types'
import type { WeeklyPlannerState, CellState, SlotLesson, Day } from './types'
import type { Unit, Group, LessonWithObjectives } from '@/types'

type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
}

export function TeacherPlannerClient({ units, groups }: TeacherPlannerClientProps) {
  const [weeklyStates, setWeeklyStates] = useState<WeeklyPlannerState>(new Map())
  const [currentWeek, setCurrentWeek] = useState<string>(getTodaySunday)
  const [weekNotes, setWeekNotesMap] = useState<Map<string, string>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())

  const currentWeekRef = useRef(currentWeek)
  currentWeekRef.current = currentWeek

  const classDefaultsRef = useRef<Map<string, string | null>>(new Map())
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
      const weekState = new Map<string, CellState>()
      for (const [key, groupId] of classDefaultsRef.current) {
        weekState.set(key, { groupId, lessons: [] })
      }
      for (const pa of data) {
        const key = slotKey(pa.day as Day, pa.period)
        const existing = weekState.get(key) ?? { groupId: pa.group_id, lessons: [] }
        existing.lessons.push({
          lessonId: pa.lesson_id,
          unitId: pa.unit_id,
          lessonTitle: pa.lesson_title,
          assignmentId: pa.id,
          feedbackVisible: pa.feedback_visible,
          issueFlag: pa.issue_flag,
          issueNote: pa.issue_note,
          lessonNotes: pa.notes,
        })
        weekState.set(key, existing)
      }
      const next = new Map(prev)
      next.set(week, weekState)
      return next
    })
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data, error } = await readTimetableSlotGroupsAction()
      if (error || !data) {
        console.error('[hydration] Failed to load timetable slot groups:', error)
      } else {
        for (const tsg of data) {
          classDefaultsRef.current.set(slotKey(tsg.day as Day, tsg.period), tsg.group_id)
        }
      }
      await loadWeekAssignments(getTodaySunday())
    }
    init()
  }, [loadWeekAssignments])

  const plannerState = weeklyStates.get(currentWeek) ?? new Map<string, CellState>()

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

  const handleUnitSelect = useCallback(async (unitId: string) => {
    if (!unitId) return
    if (lessonCache.has(unitId)) return
    const result = await readLessonsByUnitAction(unitId)
    if (result.data) {
      setLessonCache((prev) => {
        if (prev.has(unitId)) return prev
        const next = new Map(prev)
        next.set(unitId, result.data!)
        return next
      })
    }
  }, [lessonCache])

  const handleLessonChange = useCallback(async (day: Day, period: number, newLessonId: string) => {
    const week = currentWeekRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const existing = cell.lessons[0] ?? null

    if (existing) {
      await deletePlannerAssignmentAction(cell.groupId!, existing.lessonId, week, day, period)
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    if (!newLessonId || !cell.groupId || cell.groupId === '__free__') return

    const { data } = await upsertPlannerAssignmentAction(cell.groupId, newLessonId, week, day, period, {})
    if (data) {
      // Find unitId and lessonTitle from cache
      let unitId = ''
      let lessonTitle = ''
      for (const [uid, lessons] of lessonCache) {
        const found = lessons.find((l) => l.lesson_id === newLessonId)
        if (found) { unitId = uid; lessonTitle = found.title; break }
      }
      const newLesson: SlotLesson = {
        lessonId: data.lesson_id,
        unitId,
        lessonTitle,
        assignmentId: data.id,
        feedbackVisible: false,
        issueFlag: false,
        issueNote: '',
        lessonNotes: '',
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [newLesson] }))
    }
  }, [updateSlot, plannerState, lessonCache])

  const handleAddLesson = useCallback(async (day: Day, period: number, newLessonId: string) => {
    const week = currentWeekRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()

    if (!newLessonId || !cell.groupId || cell.groupId === '__free__') return
    if (cell.lessons.some((l) => l.lessonId === newLessonId)) return

    const { data } = await upsertPlannerAssignmentAction(cell.groupId, newLessonId, week, day, period, {})
    if (data) {
      let unitId = ''
      let lessonTitle = ''
      for (const [uid, lessons] of lessonCache) {
        const found = lessons.find((l) => l.lesson_id === newLessonId)
        if (found) { unitId = uid; lessonTitle = found.title; break }
      }
      const newLesson: SlotLesson = {
        lessonId: data.lesson_id,
        unitId,
        lessonTitle,
        assignmentId: data.id,
        feedbackVisible: false,
        issueFlag: false,
        issueNote: '',
        lessonNotes: '',
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [...s.lessons, newLesson] }))
    }
  }, [updateSlot, plannerState, lessonCache])

  const handleRemoveLesson = useCallback(async (day: Day, period: number, lessonId: string) => {
    const week = currentWeekRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    if (!cell.groupId) return
    await deletePlannerAssignmentAction(cell.groupId, lessonId, week, day, period)
    updateSlot(day, period, (s) => ({ ...s, lessons: s.lessons.filter((l) => l.lessonId !== lessonId) }))
  }, [updateSlot, plannerState])

  const handleFeedbackToggle = useCallback(async (day: Day, period: number, lessonId: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    const next = !lesson.feedbackVisible
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, feedbackVisible: next } : l),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { feedback_visible: next })
  }, [updateSlot, plannerState])

  const handleIssueToggle = useCallback(async (day: Day, period: number, lessonId: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    const nextFlag = !lesson.issueFlag
    const nextNote = nextFlag ? lesson.issueNote : ''
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) =>
        l.lessonId === lessonId ? { ...l, issueFlag: nextFlag, issueNote: nextNote } : l
      ),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { issue_flag: nextFlag, issue_note: nextNote })
  }, [updateSlot, plannerState])

  const handleIssueNoteChange = useCallback(async (day: Day, period: number, lessonId: string, note: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, issueNote: note } : l),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { issue_note: note })
  }, [updateSlot, plannerState])

  const handleLessonNotesChange = useCallback(async (day: Day, period: number, lessonId: string, notes: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, lessonNotes: notes } : l),
    }))
    await updatePlannerAssignmentExtrasAction(lesson.assignmentId, { notes })
  }, [updateSlot, plannerState])

  const handleGroupChange = useCallback(async (day: Day, period: number, groupId: string) => {
    const key = slotKey(day, period)
    const existing = plannerState.get(key)
    const resolvedGroupId = groupId || null

    if (existing?.groupId && existing.groupId !== groupId && groupId !== '__free__') {
      const week = currentWeekRef.current
      for (const lesson of existing.lessons) {
        await deletePlannerAssignmentAction(existing.groupId, lesson.lessonId, week, day, period)
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    if (resolvedGroupId && resolvedGroupId !== '__free__' && existing?.lessons.length) {
      const week = currentWeekRef.current
      for (const lesson of existing.lessons) {
        await upsertPlannerAssignmentAction(resolvedGroupId, lesson.lessonId, week, day, period, {
          feedbackVisible: lesson.feedbackVisible,
          issueFlag: lesson.issueFlag,
          issueNote: lesson.issueNote,
          notes: lesson.lessonNotes,
        })
      }
    }

    updateSlot(day, period, (s) => ({ ...s, groupId: resolvedGroupId }))
    if (groupId === '__free__') {
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    classDefaultsRef.current.set(key, resolvedGroupId)
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

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0">
          <PlannerGrid
            units={units}
            plannerState={plannerState}
            selectedSlot={selectedSlot}
            lessonCache={lessonCache}
            onCellClick={handleCellClick}
            onUnitSelect={handleUnitSelect}
            onLessonChange={handleLessonChange}
            onFeedbackToggle={handleFeedbackToggle}
          />
        </div>

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
          onUnitSelect={handleUnitSelect}
          onAddLesson={handleAddLesson}
          onRemoveLesson={handleRemoveLesson}
          onFeedbackToggle={handleFeedbackToggle}
          onIssueToggle={handleIssueToggle}
          onIssueNoteChange={handleIssueNoteChange}
          onLessonNotesChange={handleLessonNotesChange}
        />
      </div>

      <WeekNotes value={weekNote} onChange={handleWeekNoteChange} />
    </div>
  )
}
