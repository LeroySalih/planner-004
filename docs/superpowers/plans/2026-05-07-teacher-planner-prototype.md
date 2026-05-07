# Teacher Planner Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/tests/teacher-planner` page showing a weekly timetable grid with inline unit/lesson pickers and a slide-in side panel, using live DB data for units/lessons/groups and in-memory state.

**Architecture:** Server component fetches groups and units; passes to a single client component that owns all planner state. Lessons are fetched lazily (per unit) via server actions when the user opens a unit picker. A hardcoded `TIMETABLE_SLOTS` config maps day+period to class/room. No DB persistence — state resets on refresh.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, `cn()` utility, existing server actions (`readGroupsAction`, `readUnitsAction`, `readLessonsByUnitAction`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/teacher-planner/types.ts` | Create | Shared TypeScript types for the feature |
| `src/components/teacher-planner/timetable-config.ts` | Create | Hardcoded `PERIOD_LAYOUT` and `TIMETABLE_SLOTS` |
| `src/components/teacher-planner/WeekNotes.tsx` | Create | Textarea below the grid |
| `src/components/teacher-planner/PlannerCell.tsx` | Create | Individual timetable cell |
| `src/components/teacher-planner/PlannerGrid.tsx` | Create | Grid shell — day headers + period rows |
| `src/components/teacher-planner/SidePanel.tsx` | Create | Slide-in detail panel |
| `src/components/teacher-planner/TeacherPlannerClient.tsx` | Create | Root client component — owns all state |
| `src/app/tests/teacher-planner/page.tsx` | Create | Server component — fetches groups + units |

---

## Task 1: Create worktree

**Files:** none (git operation)

- [ ] **Step 1: Create the worktree and branch**

```bash
git worktree add .worktrees/teacher-planner-prototype -b feature/teacher-planner-prototype
```

- [ ] **Step 2: Set up the isolated DB and start the dev server**

```bash
./scripts/setup-worktree-db.sh teacher-planner-prototype --start-server
```

Expected: tmux session `worktree-teacher-planner-prototype` started, dev server on port 3001+.

- [ ] **Step 3: All subsequent work happens inside the worktree**

```bash
cd .worktrees/teacher-planner-prototype
```

All file paths in this plan are relative to the worktree root.

---

## Task 2: Shared types

**Files:**
- Create: `src/components/teacher-planner/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/components/teacher-planner/types.ts

export type Day = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday'

export type TimetableSlot = {
  day: Day
  period: number
  classCode: string   // matches group.subject in DB
  subject: string     // display string, e.g. "Design tech"
  room: string
  startTime?: string  // e.g. "08:25"
  endTime?: string    // e.g. "09:25"
}

export type PeriodRow =
  | { type: 'lesson'; period: number; label: string; startTime?: string; endTime?: string }
  | { type: 'break'; label: string }

export type CellState = {
  unitId: string | null
  lessonId: string | null
  feedbackVisible: boolean
  issueFlag: boolean
  issueNote: string
  lessonNotes: string
}

export type PlannerState = Map<string, CellState>  // key: `${day}-${period}`

export function slotKey(day: Day, period: number): string {
  return `${day}-${period}`
}

export function emptyCellState(): CellState {
  return {
    unitId: null,
    lessonId: null,
    feedbackVisible: false,
    issueFlag: false,
    issueNote: '',
    lessonNotes: '',
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-planner/types.ts
git commit -m "feat(teacher-planner): add shared types"
```

---

## Task 3: Timetable config

**Files:**
- Create: `src/components/teacher-planner/timetable-config.ts`

- [ ] **Step 1: Create the config file**

The period layout and slots below are extracted from the teacher's timetable screenshot. **Verify and correct the slot data before considering this task complete** — the time boundaries and some class codes may need adjusting.

```ts
// src/components/teacher-planner/timetable-config.ts
import type { PeriodRow, TimetableSlot } from './types'

export const PERIOD_LAYOUT: PeriodRow[] = [
  { type: 'lesson', period: 1, label: 'L1', startTime: '07:15', endTime: '07:25' },
  { type: 'lesson', period: 2, label: 'L2', startTime: '07:25', endTime: '08:25' },
  { type: 'lesson', period: 3, label: 'L3', startTime: '08:25', endTime: '09:25' },
  { type: 'break',  label: 'Break' },
  { type: 'lesson', period: 4, label: 'L4', startTime: '09:40', endTime: '10:40' },
  { type: 'lesson', period: 5, label: 'L5', startTime: '10:40', endTime: '11:40' },
  { type: 'break',  label: 'Lunch' },
  { type: 'lesson', period: 6, label: 'L6', startTime: '12:00', endTime: '13:00' },
  { type: 'lesson', period: 7, label: 'L7', startTime: '13:00', endTime: '14:00' },
]

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'] as const

export const DAY_LABELS: Record<string, string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
}

export const TIMETABLE_SLOTS: TimetableSlot[] = [
  // Sunday
  { day: 'sunday',    period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'sunday',    period: 3, classCode: '8c/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '08:25', endTime: '09:25' },
  { day: 'sunday',    period: 5, classCode: '8b/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'sunday',    period: 6, classCode: '9c/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
  { day: 'sunday',    period: 7, classCode: '10Dt2/Dt',  subject: 'Design tech', room: 'FR87', startTime: '13:00', endTime: '14:00' },
  // Monday
  { day: 'monday',    period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'monday',    period: 3, classCode: '9a/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '08:25', endTime: '09:25' },
  { day: 'monday',    period: 4, classCode: '8d/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'monday',    period: 5, classCode: '7d/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'monday',    period: 6, classCode: '11Dt/Dt',   subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
  // Tuesday
  { day: 'tuesday',   period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'tuesday',   period: 4, classCode: '9d/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'tuesday',   period: 5, classCode: '10Dt2/Dt',  subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'tuesday',   period: 7, classCode: '11Dt/Dt',   subject: 'Design tech', room: 'FR87', startTime: '13:00', endTime: '14:00' },
  // Wednesday
  { day: 'wednesday', period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'wednesday', period: 3, classCode: '11Dt/Dt',   subject: 'Design tech', room: 'FR87', startTime: '08:25', endTime: '09:25' },
  { day: 'wednesday', period: 4, classCode: '7c/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'wednesday', period: 5, classCode: '7a/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'wednesday', period: 6, classCode: '7b/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
  // Thursday
  { day: 'thursday',  period: 1, classCode: '9b/Re1',    subject: 'RE',          room: '' },
  { day: 'thursday',  period: 2, classCode: '9b/pshe',   subject: 'PSHE',        room: 'MH Hall', startTime: '07:25', endTime: '08:25' },
  { day: 'thursday',  period: 4, classCode: '10Dt2/Dt',  subject: 'Design tech', room: 'FR87', startTime: '09:40', endTime: '10:40' },
  { day: 'thursday',  period: 5, classCode: '9b/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '10:40', endTime: '11:40' },
  { day: 'thursday',  period: 6, classCode: '8a/Dt1',    subject: 'Design tech', room: 'FR87', startTime: '12:00', endTime: '13:00' },
]
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-planner/timetable-config.ts
git commit -m "feat(teacher-planner): add hardcoded timetable config"
```

---

## Task 4: WeekNotes component

**Files:**
- Create: `src/components/teacher-planner/WeekNotes.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/teacher-planner/WeekNotes.tsx
'use client'

type WeekNotesProps = {
  value: string
  onChange: (val: string) => void
}

export function WeekNotes({ value, onChange }: WeekNotesProps) {
  return (
    <div className="mt-5">
      <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5">
        Week notes
      </label>
      <textarea
        className="w-full min-h-[60px] resize-y rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-2.5 py-2 text-xs text-[var(--color-text-primary)] leading-relaxed focus:outline-none focus:border-[var(--color-border-info)] focus:ring-1 focus:ring-[var(--color-border-info)]/20"
        placeholder="Reminders for the week — assemblies, observations, deadlines…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Add CSS variables to globals.css if not already present**

Check `src/app/globals.css`. If these variables are not defined, add them inside `:root`:

```css
/* Teacher planner tokens */
--color-background-primary: #ffffff;
--color-background-secondary: #f5f4ef;
--color-background-tertiary: #faf9f5;
--color-text-primary: #1a1a1a;
--color-text-secondary: #6b6b6b;
--color-text-tertiary: #999999;
--color-border-tertiary: rgba(0,0,0,0.08);
--color-border-secondary: rgba(0,0,0,0.18);
--color-border-info: #378ADD;
```

And inside `.dark`:

```css
--color-background-primary: #1f1f1e;
--color-background-secondary: #2a2a28;
--color-background-tertiary: #181817;
--color-text-primary: #f0f0ee;
--color-text-secondary: #a8a8a3;
--color-text-tertiary: #6e6e6a;
--color-border-tertiary: rgba(255,255,255,0.08);
--color-border-secondary: rgba(255,255,255,0.18);
```

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher-planner/WeekNotes.tsx src/app/globals.css
git commit -m "feat(teacher-planner): add WeekNotes component and CSS tokens"
```

---

## Task 5: PlannerCell component

**Files:**
- Create: `src/components/teacher-planner/PlannerCell.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/teacher-planner/PlannerCell.tsx
'use client'

import { cn } from '@/lib/utils'
import type { TimetableSlot, CellState } from './types'
import type { Unit, Lesson } from '@/types'

type PlannerCellProps = {
  slot: TimetableSlot
  state: CellState
  isSelected: boolean
  units: Unit[]
  lessons: Lesson[]          // lessons for the currently selected unit (may be empty)
  onCellClick: () => void
  onUnitChange: (unitId: string) => void
  onLessonChange: (lessonId: string) => void
  onFeedbackToggle: () => void
}

export function PlannerCell({
  slot,
  state,
  isSelected,
  units,
  lessons,
  onCellClick,
  onUnitChange,
  onLessonChange,
  onFeedbackToggle,
}: PlannerCellProps) {
  const selectedUnit = units.find((u) => u.unit_id === state.unitId) ?? null
  const selectedLesson = lessons.find((l) => l.lesson_id === state.lessonId) ?? null

  return (
    <div
      className={cn(
        'relative flex flex-col gap-[3px] rounded-[8px] border bg-[var(--color-background-primary)] px-[7px] py-[6px] min-h-[86px] cursor-pointer transition-colors',
        state.issueFlag
          ? 'bg-[#FCEBEB] border-[#F09595] hover:border-[#E24B4A]'
          : 'border-[var(--color-border-tertiary)] hover:border-[var(--color-border-secondary)]',
        isSelected && !state.issueFlag && 'border-[1.5px] border-[var(--color-border-info)]',
        isSelected && state.issueFlag && 'border-[1.5px] border-[#E24B4A]',
      )}
      onClick={onCellClick}
    >
      {/* Header */}
      <div className="flex justify-between items-baseline gap-1 mb-0.5">
        <span
          className={cn(
            'font-medium text-[12px]',
            state.issueFlag ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]',
          )}
        >
          {slot.classCode}
        </span>
        <span
          className={cn(
            'text-[11px] truncate',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-secondary)]',
          )}
        >
          {slot.subject}
        </span>
      </div>

      {/* Unit picker */}
      <div
        className="relative flex items-center h-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={cn(
            'flex-1 min-w-0 text-[11px] truncate pr-0.5',
            selectedUnit
              ? state.issueFlag ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]'
              : state.issueFlag ? 'text-[#A32D2D] opacity-70' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          {selectedUnit ? selectedUnit.title : 'Unit'}
        </span>
        <span
          className={cn(
            'text-[8px] opacity-60 flex-shrink-0',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          ›
        </span>
        <select
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px]"
          value={state.unitId ?? ''}
          onChange={(e) => onUnitChange(e.target.value)}
        >
          <option value="">— select unit —</option>
          {units.map((u) => (
            <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
          ))}
        </select>
      </div>

      {/* Lesson picker */}
      <div
        className="relative flex items-center h-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={cn(
            'flex-1 min-w-0 text-[11px] truncate pr-0.5',
            !state.unitId
              ? 'text-[var(--color-text-tertiary)] opacity-50'
              : selectedLesson
              ? state.issueFlag ? 'text-[#791F1F]' : 'text-[var(--color-text-primary)]'
              : state.issueFlag ? 'text-[#A32D2D] opacity-70' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          {selectedLesson ? selectedLesson.title : 'Lesson'}
        </span>
        <span
          className={cn(
            'text-[8px] flex-shrink-0',
            !state.unitId ? 'opacity-25' : 'opacity-60',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
        >
          ›
        </span>
        <select
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[11px] disabled:cursor-not-allowed"
          value={state.lessonId ?? ''}
          disabled={!state.unitId}
          onChange={(e) => onLessonChange(e.target.value)}
        >
          <option value="">— select lesson —</option>
          {lessons.map((l) => (
            <option key={l.lesson_id} value={l.lesson_id}>{l.title}</option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <hr
        className={cn(
          'border-none border-t mt-0.5',
          state.issueFlag
            ? 'border-t-[rgba(162,45,45,0.2)]'
            : 'border-t-[var(--color-border-tertiary)]',
        )}
        style={{ borderTopWidth: '0.5px' }}
      />

      {/* Icon row */}
      <div
        className="flex items-center gap-0.5 mt-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Feedback check */}
        <button
          type="button"
          className={cn(
            'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] transition-opacity',
            state.feedbackVisible
              ? 'opacity-100 text-[#1D9E75]'
              : state.issueFlag
              ? 'text-[#A32D2D] opacity-50 hover:opacity-100'
              : 'text-[var(--color-text-tertiary)] opacity-50 hover:opacity-100',
          )}
          onClick={onFeedbackToggle}
          title="Toggle feedback visible"
        >
          ✓
        </button>
        {/* Grades link — disabled for prototype (no URL) */}
        <button
          type="button"
          className={cn(
            'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] font-medium opacity-20 cursor-default',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
          disabled
          title="Grades page (not configured)"
        >
          %
        </button>
        {/* Slides link — disabled for prototype (no URL) */}
        <button
          type="button"
          className={cn(
            'w-[16px] h-[16px] flex items-center justify-center rounded-[2px] border-none bg-transparent text-[9px] opacity-20 cursor-default',
            state.issueFlag ? 'text-[#A32D2D]' : 'text-[var(--color-text-tertiary)]',
          )}
          disabled
          title="Slide deck (not configured)"
        >
          ▶
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-planner/PlannerCell.tsx
git commit -m "feat(teacher-planner): add PlannerCell component"
```

---

## Task 6: PlannerGrid component

**Files:**
- Create: `src/components/teacher-planner/PlannerGrid.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/teacher-planner/PlannerGrid.tsx
'use client'

import { cn } from '@/lib/utils'
import { PlannerCell } from './PlannerCell'
import { PERIOD_LAYOUT, TIMETABLE_SLOTS, DAYS, DAY_LABELS } from './timetable-config'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day, CellState } from './types'
import type { Unit, Lesson } from '@/types'

type PlannerGridProps = {
  units: Unit[]
  plannerState: PlannerState
  selectedSlot: string | null
  lessonCache: Map<string, Lesson[]>
  onCellClick: (day: Day, period: number) => void
  onUnitChange: (day: Day, period: number, unitId: string) => void
  onLessonChange: (day: Day, period: number, lessonId: string) => void
  onFeedbackToggle: (day: Day, period: number) => void
}

export function PlannerGrid({
  units,
  plannerState,
  selectedSlot,
  lessonCache,
  onCellClick,
  onUnitChange,
  onLessonChange,
  onFeedbackToggle,
}: PlannerGridProps) {
  return (
    <div className="text-[13px]">
      {/* Day headers */}
      <div className="grid gap-[4px]" style={{ gridTemplateColumns: '70px repeat(5, minmax(0, 1fr))' }}>
        <div />
        {DAYS.map((day) => (
          <div
            key={day}
            className="text-[12px] font-medium text-[var(--color-text-secondary)] text-center px-1 py-1.5"
          >
            {DAY_LABELS[day]}
          </div>
        ))}
      </div>

      {/* Period rows */}
      <div className="flex flex-col gap-[4px] mt-[4px]">
        {PERIOD_LAYOUT.map((row, idx) => {
          if (row.type === 'break') {
            return (
              <div
                key={`break-${idx}`}
                className="grid gap-[4px]"
                style={{ gridTemplateColumns: '70px repeat(5, minmax(0, 1fr))' }}
              >
                <div />
                <div
                  className="col-span-5 rounded-[8px] bg-[var(--color-background-secondary)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] text-center tracking-wide"
                >
                  {row.label}
                </div>
              </div>
            )
          }

          return (
            <div
              key={`period-${row.period}`}
              className="grid gap-[4px]"
              style={{ gridTemplateColumns: '70px repeat(5, minmax(0, 1fr))' }}
            >
              {/* Row label */}
              <div className="flex flex-col items-end justify-center pr-2 text-right">
                <span className="font-medium text-[13px] text-[var(--color-text-primary)]">{row.label}</span>
                {row.startTime && (
                  <span className="text-[10px] text-[var(--color-text-secondary)] leading-tight">{row.startTime}</span>
                )}
              </div>

              {/* Cells for each day */}
              {DAYS.map((day) => {
                const slot = TIMETABLE_SLOTS.find(
                  (s) => s.day === day && s.period === row.period,
                )

                if (!slot) {
                  return (
                    <div
                      key={day}
                      className="rounded-[8px] border border-[var(--color-border-tertiary)] min-h-[86px] bg-[var(--color-background-secondary)] opacity-30"
                    />
                  )
                }

                const key = slotKey(day, row.period)
                const state: CellState = plannerState.get(key) ?? emptyCellState()
                const lessons = lessonCache.get(state.unitId ?? '') ?? []

                return (
                  <PlannerCell
                    key={day}
                    slot={slot}
                    state={state}
                    isSelected={selectedSlot === key}
                    units={units}
                    lessons={lessons}
                    onCellClick={() => onCellClick(day, row.period)}
                    onUnitChange={(unitId) => onUnitChange(day, row.period, unitId)}
                    onLessonChange={(lessonId) => onLessonChange(day, row.period, lessonId)}
                    onFeedbackToggle={() => onFeedbackToggle(day, row.period)}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-planner/PlannerGrid.tsx
git commit -m "feat(teacher-planner): add PlannerGrid component"
```

---

## Task 7: SidePanel component

**Files:**
- Create: `src/components/teacher-planner/SidePanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/teacher-planner/SidePanel.tsx
'use client'

import { cn } from '@/lib/utils'
import { TIMETABLE_SLOTS, DAY_LABELS, PERIOD_LAYOUT } from './timetable-config'
import { slotKey } from './types'
import type { Day, CellState } from './types'
import type { Unit, Lesson, Group } from '@/types'

type SidePanelProps = {
  selectedSlot: string | null    // e.g. "monday-3"
  plannerState: Map<string, CellState>
  units: Unit[]
  lessonCache: Map<string, Lesson[]>
  groups: Group[]
  onClose: () => void
  onIssueToggle: (day: Day, period: number) => void
  onIssueNoteChange: (day: Day, period: number, note: string) => void
  onLessonNotesChange: (day: Day, period: number, notes: string) => void
}

function parseDayPeriod(key: string): { day: Day; period: number } | null {
  const idx = key.lastIndexOf('-')
  if (idx === -1) return null
  return { day: key.slice(0, idx) as Day, period: Number(key.slice(idx + 1)) }
}

export function SidePanel({
  selectedSlot,
  plannerState,
  units,
  lessonCache,
  groups,
  onClose,
  onIssueToggle,
  onIssueNoteChange,
  onLessonNotesChange,
}: SidePanelProps) {
  const isOpen = selectedSlot !== null

  if (!isOpen || !selectedSlot) return null

  const parsed = parseDayPeriod(selectedSlot)
  if (!parsed) return null
  const { day, period } = parsed

  const slot = TIMETABLE_SLOTS.find((s) => s.day === day && s.period === period)
  const state = plannerState.get(selectedSlot)

  if (!slot || !state) return null

  const selectedUnit = units.find((u) => u.unit_id === state.unitId) ?? null
  const lessons = lessonCache.get(state.unitId ?? '') ?? []
  const selectedLesson = lessons.find((l) => l.lesson_id === state.lessonId) ?? null
  const group = groups.find((g) => g.subject === slot.classCode) ?? null

  const periodRow = PERIOD_LAYOUT.find(
    (r) => r.type === 'lesson' && r.period === period,
  )
  const periodLabel = periodRow?.type === 'lesson' ? periodRow.label : `L${period}`

  // Find objectives from lesson (LessonWithObjectives shape from readLessonsByUnitAction)
  const lessonWithObjectives = selectedLesson as (Lesson & { lesson_objectives?: Array<{ title: string }> }) | null
  const objectives = lessonWithObjectives?.lesson_objectives
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
              state.issueFlag
                ? 'bg-[#FCEBEB] border-[#F09595] text-[#791F1F]'
                : 'border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]',
            )}
            onClick={() => onIssueToggle(day, period)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onIssueToggle(day, period) }}
          >
            <span>Flag this lesson</span>
            {/* Toggle switch */}
            <div
              className={cn(
                'w-7 h-4 rounded-full relative flex-shrink-0 transition-colors',
                state.issueFlag ? 'bg-[#E24B4A]' : 'bg-[var(--color-border-secondary)]',
              )}
            >
              <div
                className={cn(
                  'w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left] duration-150',
                  state.issueFlag ? 'left-[14px]' : 'left-0.5',
                )}
              />
            </div>
          </div>
          {state.issueFlag && (
            <textarea
              className="mt-1.5 w-full text-[12px] bg-[var(--color-background-secondary)] border border-[#F09595] rounded-[8px] px-2.5 py-2 resize-y min-h-[56px] text-[#791F1F] focus:outline-none focus:border-[#E24B4A] box-border"
              placeholder="Describe the issue…"
              value={state.issueNote}
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
            value={state.lessonNotes}
            onChange={(e) => onLessonNotesChange(day, period, e.target.value)}
          />
        </div>

      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-planner/SidePanel.tsx
git commit -m "feat(teacher-planner): add SidePanel component"
```

---

## Task 8: TeacherPlannerClient

**Files:**
- Create: `src/components/teacher-planner/TeacherPlannerClient.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/teacher-planner/TeacherPlannerClient.tsx
'use client'

import { useState, useCallback } from 'react'
import { readLessonsByUnitAction } from '@/lib/server-updates'
import { PlannerGrid } from './PlannerGrid'
import { SidePanel } from './SidePanel'
import { WeekNotes } from './WeekNotes'
import { slotKey, emptyCellState } from './types'
import type { PlannerState, Day, CellState } from './types'
import type { Unit, Group } from '@/types'
import type { Lesson } from '@/types'

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
  }, [lessonCache])

  const handleLessonChange = useCallback((day: Day, period: number, lessonId: string) => {
    updateCellState(day, period, { lessonId: lessonId || null })
  }, [])

  const handleFeedbackToggle = useCallback((day: Day, period: number) => {
    const current = getCellState(day, period)
    updateCellState(day, period, { feedbackVisible: !current.feedbackVisible })
  }, [plannerState])

  const handleIssueToggle = useCallback((day: Day, period: number) => {
    const current = getCellState(day, period)
    updateCellState(day, period, { issueFlag: !current.issueFlag, issueNote: '' })
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher-planner/TeacherPlannerClient.tsx
git commit -m "feat(teacher-planner): add TeacherPlannerClient root component"
```

---

## Task 9: Server component page

**Files:**
- Create: `src/app/tests/teacher-planner/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// src/app/tests/teacher-planner/page.tsx
import { readGroupsAction, readUnitsAction } from '@/lib/server-updates'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage() {
  const [groupsResult, unitsResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[760px] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data. Make sure you are signed in as a teacher.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <div className="max-w-[760px] mx-auto mb-6">
        <h1 className="text-xl font-medium text-[var(--color-text-primary)] m-0">
          Weekly planner
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1 m-0">
          Prototype — state resets on refresh
        </p>
      </div>
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
      />
    </main>
  )
}
```

- [ ] **Step 2: Verify the dev server is running**

```bash
tmux attach -t worktree-teacher-planner-prototype
```

Check for build errors. Detach with `Ctrl+B, D`.

- [ ] **Step 3: Open the page in a browser**

Navigate to `http://localhost:<PORT>/tests/teacher-planner` (port shown in tmux output).

Expected:
- Weekly grid renders with 5 day columns and period rows
- Break and Lunch rows appear as muted banners
- Each slot with a class shows the class code and subject
- Empty period/day combinations show a muted blank cell

- [ ] **Step 4: Smoke test interactions**

1. Click a cell → side panel slides in from the right, overlay appears behind the grid
2. Click the overlay → panel closes
3. Open a DT cell → click the unit picker → select a unit → lesson picker activates
4. Select a lesson → lesson title appears in the cell
5. Click the cell again → side panel shows the correct unit/lesson in Details section
6. Toggle the issue flag in the side panel → cell turns red
7. Toggle the ✓ icon → check turns teal
8. Type in week notes → text persists while panel is open

- [ ] **Step 5: Commit**

```bash
git add src/app/tests/teacher-planner/page.tsx
git commit -m "feat(teacher-planner): add server component page and wire up client"
```

---

## Task 10: Fix timetable data and polish

**Files:**
- Modify: `src/components/teacher-planner/timetable-config.ts`

- [ ] **Step 1: Verify each timetable slot against the actual screenshot**

Open the screenshot and compare each entry in `TIMETABLE_SLOTS`. Correct any class codes, rooms, or periods that are wrong. The data extracted in Task 3 is approximate — this step finalises it.

- [ ] **Step 2: Check dark mode**

Toggle dark mode in the app. Verify:
- Grid background, cell backgrounds, and text all shift correctly
- Issue red state (red-50 background) is still readable — it may need a dark-mode override if it looks wrong

- [ ] **Step 3: Check the side panel doesn't clip on short screens**

Resize the browser to ~900px height. Verify the panel scrolls independently rather than being cut off.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(teacher-planner): finalise timetable data and dark mode polish"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Route `/tests/teacher-planner` — Task 9
- ✅ Server component fetches groups + units — Task 9
- ✅ Lazy lesson loading per unit — Task 8
- ✅ Hardcoded timetable config (`TIMETABLE_SLOTS`, `PERIOD_LAYOUT`) — Task 3
- ✅ In-memory state — Task 8
- ✅ Cell states: default, active, issue — Task 5
- ✅ Unit picker + lesson picker (native select, opacity 0) — Task 5
- ✅ Feedback toggle (✓ icon, teal when on) — Task 5
- ✅ % and ▶ icons (disabled in prototype) — Task 5
- ✅ PlannerGrid with break/lunch rows — Task 6
- ✅ SidePanel: header, details, previous lesson placeholder, issue toggle, objectives, lesson notes — Task 7
- ✅ WeekNotes — Task 4
- ✅ Worktree — Task 1
- ✅ Group matching by `group.subject` — Task 7 (SidePanel pupil count)
- ✅ Files section omitted — confirmed not in any task
