'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { readPlannerSowUnitsAction,
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
  isAdmin: boolean
  initialWeek?: string
  initialSelectedTeacherId?: string
}

function cacheKey(teacherId: string, week: string) {
  return `${teacherId}::${week}`
}

export function TeacherPlannerClient({ units, groups, teachers, currentTeacherId, isAdmin, initialWeek, initialSelectedTeacherId }: TeacherPlannerClientProps) {
  const [weeklyStates, setWeeklyStates] = useState<WeeklyPlannerState>(new Map())
  const [currentWeek, setCurrentWeek] = useState<string>(initialWeek ?? getTodaySunday)
  // group id -> units in that group's scheme of work for the half-term this
  // week falls in. Used only to order the unit dropdown, so a failure to load
  // it degrades to the previous behaviour rather than breaking the planner.
  const [sowUnits, setSowUnits] = useState<Map<string, Set<string>>>(new Map())
  const [weekNotes, setWeekNotesMap] = useState<Map<string, string>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(initialSelectedTeacherId ?? currentTeacherId)
  const [lessonScores, setLessonScores] = useState<Map<string, number | null>>(new Map())

  const readOnly = selectedTeacherId !== currentTeacherId && !isAdmin

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
    loadWeekAssignments(currentTeacherId, currentWeekRef.current)
  }, [loadWeekAssignments, currentTeacherId])

  useEffect(() => {
    if (selectedTeacherId === currentTeacherId) return
    loadWeekAssignments(selectedTeacherId, currentWeekRef.current)
  }, [loadWeekAssignments, selectedTeacherId, currentTeacherId])

  useEffect(() => {
    let cancelled = false
    void readPlannerSowUnitsAction(currentWeek).then((result) => {
      if (cancelled) return
      const next = new Map<string, Set<string>>()
      for (const row of result.data ?? []) {
        if (!next.has(row.group_id)) next.set(row.group_id, new Set())
        next.get(row.group_id)!.add(row.unit_id)
      }
      setSowUnits(next)
    })
    return () => { cancelled = true }
  }, [currentWeek])

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

  /**
   * Run a planner write and report it if it fails.
   *
   * These server actions return { error } rather than throwing, so an ignored
   * result is an invisible failure — and every handler below updates local
   * state either before the write or without waiting on it, which leaves the
   * teacher looking at an edit that was never saved. `revert` restores the
   * slot so the grid keeps telling the truth.
   *
   * The message doubles as the toast id: a failing database would otherwise
   * raise one toast per keystroke in the note fields.
   */
  const commit = useCallback(
    async <T,>(
      action: Promise<{ data: T; error: string | null }>,
      message: string,
      revert?: () => void,
    ): Promise<{ ok: boolean; data: T | null }> => {
      const { data, error } = await action
      if (error) {
        revert?.()
        toast.error(message, { id: message, description: error })
        return { ok: false, data: null }
      }
      return { ok: true, data }
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
    const teacherId = selectedTeacherIdRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const existing = cell.lessons[0] ?? null

    if (existing) {
      const { ok } = await commit(
        deletePlannerAssignmentAction(cell.groupId!, existing.lessonId, week, day, period, teacherId),
        'Could not remove the previous lesson',
      )
      if (!ok) return
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    if (!newLessonId || !cell.groupId) return

    // No revert: the old lesson is already gone from the database, so an empty
    // slot is the truthful state if this add fails.
    const { data } = await commit(
      upsertPlannerAssignmentAction(cell.groupId, newLessonId, week, day, period, teacherId, {}),
      'Could not add the lesson',
    )
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
  }, [updateSlot, plannerState, lessonCache, commit])

  const handleAddLesson = useCallback(async (day: Day, period: number, newLessonId: string) => {
    const week = currentWeekRef.current
    const teacherId = selectedTeacherIdRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()

    if (!newLessonId || !cell.groupId) return
    if (cell.lessons.some((l) => l.lessonId === newLessonId)) return

    const { data } = await commit(
      upsertPlannerAssignmentAction(cell.groupId, newLessonId, week, day, period, teacherId, {}),
      'Could not add the lesson',
    )
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
    return Boolean(data)
  }, [updateSlot, plannerState, lessonCache, commit])

  const handleRemoveLesson = useCallback(async (day: Day, period: number, lessonId: string) => {
    const week = currentWeekRef.current
    const teacherId = selectedTeacherIdRef.current
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    if (!cell.groupId) return false
    const { ok } = await commit(
      deletePlannerAssignmentAction(cell.groupId, lessonId, week, day, period, teacherId),
      'Could not remove the lesson',
    )
    if (!ok) return false
    updateSlot(day, period, (s) => ({ ...s, lessons: s.lessons.filter((l) => l.lessonId !== lessonId) }))
    return true
  }, [updateSlot, plannerState, commit])

  const handleSwapLesson = useCallback(async (day: Day, period: number, oldLessonId: string, newLessonId: string) => {
    const removed = await handleRemoveLesson(day, period, oldLessonId)
    if (!removed) return
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
    await commit(
      updatePlannerAssignmentExtrasAction(lesson.assignmentId, { feedback_visible: next }, selectedTeacherIdRef.current),
      'Could not change feedback visibility',
      () => updateSlot(day, period, () => cell),
    )
  }, [updateSlot, plannerState, commit])

  const handleIssueToggle = useCallback(async (day: Day, period: number) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const nextFlag = !cell.issueFlag
    const nextNote = nextFlag ? cell.issueNote : ''
    updateSlot(day, period, (s) => ({ ...s, issueFlag: nextFlag, issueNote: nextNote }))
    await commit(
      upsertPlannerPeriodFlagAction(currentWeekRef.current, day, period, nextFlag, nextNote),
      'Could not save the period warning',
      () => updateSlot(day, period, () => cell),
    )
  }, [updateSlot, plannerState, commit])

  const handleIssueNoteChange = useCallback(async (day: Day, period: number, note: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    updateSlot(day, period, (s) => ({ ...s, issueNote: note }))
    await commit(
      upsertPlannerPeriodFlagAction(currentWeekRef.current, day, period, cell.issueFlag, note),
      'Could not save the warning note',
    )
  }, [updateSlot, plannerState, commit])

  const handleLessonNotesChange = useCallback(async (day: Day, period: number, lessonId: string, notes: string) => {
    const key = slotKey(day, period)
    const cell = plannerState.get(key) ?? emptyCellState()
    const lesson = cell.lessons.find((l) => l.lessonId === lessonId)
    if (!lesson) return
    updateSlot(day, period, (s) => ({
      ...s,
      lessons: s.lessons.map((l) => l.lessonId === lessonId ? { ...l, lessonNotes: notes } : l),
    }))
    await commit(
      updatePlannerAssignmentExtrasAction(lesson.assignmentId, { notes }, selectedTeacherIdRef.current),
      'Could not save the lesson notes',
    )
  }, [updateSlot, plannerState, commit])

  const handleGroupChange = useCallback(async (day: Day, period: number, groupId: string) => {
    const key = slotKey(day, period)
    const existing = plannerState.get(key)
    const previous = existing ?? emptyCellState()
    const resolvedGroupId = groupId || null
    const teacherId = selectedTeacherIdRef.current

    if (existing?.groupId && existing.groupId !== groupId) {
      const week = currentWeekRef.current
      for (const lesson of existing.lessons) {
        const { ok } = await commit(
          deletePlannerAssignmentAction(existing.groupId, lesson.lessonId, week, day, period, teacherId),
          'Could not clear the lessons from the previous class',
        )
        if (!ok) return
      }
      updateSlot(day, period, (s) => ({ ...s, lessons: [] }))
    }

    if (resolvedGroupId && existing?.lessons.length) {
      const week = currentWeekRef.current
      for (const lesson of existing.lessons) {
        const { ok } = await commit(
          upsertPlannerAssignmentAction(resolvedGroupId, lesson.lessonId, week, day, period, teacherId, {
            feedbackVisible: lesson.feedbackVisible,
            notes: lesson.lessonNotes,
          }),
          'Could not move the lessons to the new class',
        )
        if (!ok) return
      }
    }

    updateSlot(day, period, (s) => ({ ...s, groupId: resolvedGroupId }))

    const classDefaults = classDefaultsByTeacherRef.current.get(teacherId)
    classDefaults?.set(key, resolvedGroupId)
    // The defaults cache is what rehydrates the grid when the week is
    // revisited, so it has to be rolled back with the slot or the unsaved
    // class reappears as though it had stuck.
    await commit(
      upsertTimetableSlotGroupAction(day, period, resolvedGroupId, teacherId),
      'Could not save the class for this period',
      () => {
        classDefaults?.set(key, previous.groupId)
        updateSlot(day, period, () => previous)
      },
    )
  }, [updateSlot, plannerState, commit])

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
          sowUnits={sowUnits}
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
