'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  readLessonsByUnitAction,
  readLessonAssignmentScoreSummariesAction,
  upsertPlannerAssignmentAction,
  deletePlannerAssignmentAction,
  readPlannerAssignmentsForWeekAction,
  updatePlannerAssignmentExtrasAction,
  readTimetableSlotGroupsAction,
  upsertTimetableSlotGroupAction,
  readPlannerPeriodFlagsForWeekAction,
  upsertPlannerPeriodFlagAction,
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
  teachers: { userId: string; firstName: string | null; lastName: string | null }[]
  currentTeacherId: string
}

function cacheKey(teacherId: string, week: string) {
  return `${teacherId}::${week}`
}

export function TeacherPlannerClient({ units, groups, teachers, currentTeacherId }: TeacherPlannerClientProps) {
  const [weeklyStates, setWeeklyStates] = useState<WeeklyPlannerState>(new Map())
  const [currentWeek, setCurrentWeek] = useState<string>(getTodaySunday)
  const [weekNotes, setWeekNotesMap] = useState<Map<string, string>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(currentTeacherId)
  const [lessonScores, setLessonScores] = useState<Map<string, number | null>>(new Map())

  const readOnly = selectedTeacherId !== currentTeacherId

  const currentWeekRef = useRef(currentWeek)
  currentWeekRef.current = currentWeek

  const selectedTeacherIdRef = useRef(selectedTeacherId)
  selectedTeacherIdRef.current = selectedTeacherId

  const classDefaultsByTeacherRef = useRef<Map<string, Map<string, string | null>>>(new Map())
  const loadedWeeksByTeacherRef = useRef<Map<string, Set<string>>>(new Map())

  const loadWeekAssignments = useCallback(async (teacherId: string, week: string) => {
    const loadedWeeks = loadedWeeksByTeacherRef.current.get(teacherId) ?? new Set<string>()
    loadedWeeksByTeacherRef.current.set(teacherId, loadedWeeks)
    if (loadedWeeks.has(week)) return

    let classDefaults = classDefaultsByTeacherRef.current.get(teacherId)
    if (!classDefaults) {
      classDefaults = new Map<string, string | null>()
      classDefaultsByTeacherRef.current.set(teacherId, classDefaults)
      const { data, error } = await readTimetableSlotGroupsAction(teacherId)
      if (error || !data) {
        console.error('[hydration] Failed to load timetable slot groups:', error)
      } else {
        for (const tsg of data) {
          classDefaults.set(slotKey(tsg.day as Day, tsg.period), tsg.group_id)
        }
      }
    }

    const [assignmentsResult, flagsResult] = await Promise.all([
      readPlannerAssignmentsForWeekAction(week, teacherId),
      readPlannerPeriodFlagsForWeekAction(week),
    ])
    if (assignmentsResult.error || !assignmentsResult.data) {
      console.error('[loadWeekAssignments] Failed to load week:', week, assignmentsResult.error)
      return
    }
    loadedWeeks.add(week)
    const flagsByKey = new Map<string, { issueFlag: boolean; issueNote: string }>()
    for (const f of flagsResult.data ?? []) {
      flagsByKey.set(slotKey(f.day as Day, f.period), { issueFlag: f.issue_flag, issueNote: f.issue_note })
    }
    setWeeklyStates((prev) => {
      const weekState = new Map<string, CellState>()
      for (const [key, groupId] of classDefaults!) {
        const flag = flagsByKey.get(key) ?? { issueFlag: false, issueNote: '' }
        weekState.set(key, { groupId, lessons: [], ...flag })
      }
      for (const pa of assignmentsResult.data!) {
        const key = slotKey(pa.day as Day, pa.period)
        const flag = flagsByKey.get(key) ?? { issueFlag: false, issueNote: '' }
        const existing = weekState.get(key) ?? { groupId: pa.group_id, lessons: [], ...flag }
        existing.lessons.push({
          lessonId: pa.lesson_id,
          unitId: pa.unit_id,
          lessonTitle: pa.lesson_title,
          assignmentId: pa.id,
          feedbackVisible: pa.feedback_visible,
          lessonNotes: pa.notes,
        })
        weekState.set(key, existing)
      }
      const next = new Map(prev)
      next.set(cacheKey(teacherId, week), weekState)
      return next
    })

    const scorePairs = (assignmentsResult.data ?? [])
      .filter((pa) => pa.group_id && pa.lesson_id)
      .map((pa) => ({ groupId: pa.group_id, lessonId: pa.lesson_id }))
    if (scorePairs.length > 0) {
      const scoreResult = await readLessonAssignmentScoreSummariesAction({ pairs: scorePairs })
      if (scoreResult.data) {
        setLessonScores((prev) => {
          const next = new Map(prev)
          for (const s of scoreResult.data!) {
            next.set(`${s.group_id}::${s.lesson_id}`, s.activities_average)
          }
          return next
        })
      }
    }
  }, [])

  useEffect(() => {
    loadWeekAssignments(currentTeacherId, getTodaySunday())
  }, [loadWeekAssignments, currentTeacherId])

  useEffect(() => {
    if (selectedTeacherId === currentTeacherId) return
    loadWeekAssignments(selectedTeacherId, currentWeekRef.current)
  }, [loadWeekAssignments, selectedTeacherId, currentTeacherId])

  const plannerState = weeklyStates.get(cacheKey(selectedTeacherId, currentWeek)) ?? new Map<string, CellState>()

  const updateSlot = useCallback(
    (day: Day, period: number, update: (s: CellState) => CellState) => {
      const week = currentWeekRef.current
      const teacherId = selectedTeacherIdRef.current
      const key = slotKey(day, period)
      setWeeklyStates((prev) => {
        const mapKey = cacheKey(teacherId, week)
        const weekState = prev.get(mapKey) ?? new Map()
        const current = weekState.get(key) ?? emptyCellState()
        const nextWeekState = new Map(weekState)
        nextWeekState.set(key, update(current))
        const next = new Map(prev)
        next.set(mapKey, nextWeekState)
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

  const handleSwapLesson = useCallback(async (day: Day, period: number, oldLessonId: string, newLessonId: string) => {
    await handleRemoveLesson(day, period, oldLessonId)
    await handleAddLesson(day, period, newLessonId)
  }, [handleRemoveLesson, handleAddLesson])

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

  const handleIssueToggle = useCallback(async (day: Day, period: number) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const nextFlag = !cell.issueFlag
    const nextNote = nextFlag ? cell.issueNote : ''
    updateSlot(day, period, (s) => ({ ...s, issueFlag: nextFlag, issueNote: nextNote }))
    await upsertPlannerPeriodFlagAction(currentWeekRef.current, day, period, nextFlag, nextNote)
  }, [updateSlot, plannerState])

  const handleIssueNoteChange = useCallback(async (day: Day, period: number, note: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    updateSlot(day, period, (s) => ({ ...s, issueNote: note }))
    await upsertPlannerPeriodFlagAction(currentWeekRef.current, day, period, cell.issueFlag, note)
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
          notes: lesson.lessonNotes,
        })
      }
    }

    updateSlot(day, period, (s) => ({ ...s, groupId: resolvedGroupId }))
    if (groupId === '__free__') {
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    const classDefaults = classDefaultsByTeacherRef.current.get(selectedTeacherIdRef.current)
    classDefaults?.set(key, resolvedGroupId)
    await upsertTimetableSlotGroupAction(day, period, resolvedGroupId)
  }, [updateSlot, plannerState])

  const handlePrevWeek = useCallback(() => {
    const next = shiftWeek(currentWeekRef.current, -1)
    setCurrentWeek(next)
    setSelectedSlot(null)
    loadWeekAssignments(selectedTeacherIdRef.current, next)
  }, [loadWeekAssignments])

  const handleNextWeek = useCallback(() => {
    const next = shiftWeek(currentWeekRef.current, 1)
    setCurrentWeek(next)
    setSelectedSlot(null)
    loadWeekAssignments(selectedTeacherIdRef.current, next)
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
    <>
      <div className="max-w-[95%] mx-auto mb-6 flex items-center gap-4">
        <h1 className="text-xl font-medium text-[var(--color-text-primary)] m-0">
          Weekly planner
        </h1>
        <select
          value={selectedTeacherId}
          onChange={(e) => {
            setSelectedTeacherId(e.target.value)
            setSelectedSlot(null)
          }}
          className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1 text-[var(--color-text-primary)]"
        >
          {teachers.map((t) => (
            <option key={t.userId} value={t.userId}>
              {[t.firstName, t.lastName].filter(Boolean).join(' ') || t.userId}
              {t.userId === currentTeacherId ? ' (me)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div
        className="w-[95%] mx-auto rounded-[12px] bg-[var(--color-background-tertiary)] p-4 transition-[padding-right] duration-200"
        style={{ paddingRight: selectedSlot ? 'calc(320px + 1rem)' : undefined }}
      >
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
          lessonScores={lessonScores}
          onCellClick={handleCellClick}
          onUnitSelect={handleUnitSelect}
          onLessonChange={handleLessonChange}
          onFeedbackToggle={handleFeedbackToggle}
          readOnly={readOnly}
        />

        <WeekNotes value={weekNote} onChange={handleWeekNoteChange} readOnly={readOnly} />
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
        onSwapLesson={handleSwapLesson}
        onFeedbackToggle={handleFeedbackToggle}
        onIssueToggle={handleIssueToggle}
        onIssueNoteChange={handleIssueNoteChange}
        onLessonNotesChange={handleLessonNotesChange}
        readOnly={readOnly}
      />
    </>
  )
}
