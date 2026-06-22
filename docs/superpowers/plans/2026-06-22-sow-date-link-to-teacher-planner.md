# SoW Week Date Links to Teacher Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every week label in the SoW week-by-week table a link to `/teacher-planner` that lands on that exact week (and teacher, if relevant), via minimal one-time URL-param seeding.

**Architecture:** Thread the already-computed week ISO date and the already-resolved target-teacher id down through `SowWeekList` → `SowWeekRow`, wrapping the week label in a `next/link` `Link`. On `/teacher-planner`, read `?week=`/`?teacherId=` once on page load and use them only to seed `TeacherPlannerClient`'s existing `currentWeek`/`selectedTeacherId` state — no continuous URL syncing, no new authorization logic.

**Tech Stack:** Next.js App Router (server page `searchParams`, client component state), React.

**Testing note:** No unit/integration test runner exists for server actions/pages in this repo (confirmed across every prior feature in this codebase). Verification is manual; Task 4 is the end-to-end pass.

---

### Task 1: Seed Teacher Planner's initial week/teacher from URL params

**Files:**
- Modify: `src/app/teacher-planner/page.tsx`
- Modify: `src/components/teacher-planner/TeacherPlannerClient.tsx`

Current full content of `page.tsx`:

```tsx
import { readGroupsAction, readUnitsAction, readTeachersAction } from '@/lib/server-updates'
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage() {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')

  const [groupsResult, unitsResult, teachersResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
    readTeachersAction(),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[95%] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
      />
    </main>
  )
}
```

- [ ] **Step 1: Update `page.tsx` to read and pass through `searchParams`**

Replace the entire file with:

```tsx
import { readGroupsAction, readUnitsAction, readTeachersAction } from '@/lib/server-updates'
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { TeacherPlannerClient } from '@/components/teacher-planner/TeacherPlannerClient'

export default async function TeacherPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; teacherId?: string }>
}) {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')
  const { week, teacherId } = await searchParams

  const [groupsResult, unitsResult, teachersResult] = await Promise.all([
    readGroupsAction(),
    readUnitsAction(),
    readTeachersAction(),
  ])

  if (groupsResult.error || unitsResult.error) {
    return (
      <div className="max-w-[95%] mx-auto p-8 text-sm text-red-600">
        Failed to load planner data.
        {groupsResult.error && <p>{groupsResult.error}</p>}
        {unitsResult.error && <p>{unitsResult.error}</p>}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <TeacherPlannerClient
        units={unitsResult.data ?? []}
        groups={groupsResult.data ?? []}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
        initialWeek={week}
        initialSelectedTeacherId={teacherId}
      />
    </main>
  )
}
```

- [ ] **Step 2: Update `TeacherPlannerClient.tsx`'s props type and seed its two state variables**

Current relevant lines (near the top of the file):

```ts
type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
  teachers: { userId: string; firstName: string | null; lastName: string | null }[]
  currentTeacherId: string
  isAdmin: boolean
}
```

```ts
export function TeacherPlannerClient({ units, groups, teachers, currentTeacherId, isAdmin }: TeacherPlannerClientProps) {
  const [weeklyStates, setWeeklyStates] = useState<WeeklyPlannerState>(new Map())
  const [currentWeek, setCurrentWeek] = useState<string>(getTodaySunday)
  const [weekNotes, setWeekNotesMap] = useState<Map<string, string>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(currentTeacherId)
  const [lessonScores, setLessonScores] = useState<Map<string, number | null>>(new Map())
```

Change the type to:

```ts
type TeacherPlannerClientProps = {
  units: Unit[]
  groups: Group[]
  teachers: { userId: string; firstName: string | null; lastName: string | null }[]
  currentTeacherId: string
  isAdmin: boolean
  initialWeek?: string
  initialSelectedTeacherId?: string
}
```

Change the function signature and the two relevant `useState` calls to:

```ts
export function TeacherPlannerClient({ units, groups, teachers, currentTeacherId, isAdmin, initialWeek, initialSelectedTeacherId }: TeacherPlannerClientProps) {
  const [weeklyStates, setWeeklyStates] = useState<WeeklyPlannerState>(new Map())
  const [currentWeek, setCurrentWeek] = useState<string>(initialWeek ?? getTodaySunday)
  const [weekNotes, setWeekNotesMap] = useState<Map<string, string>>(new Map())
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [lessonCache, setLessonCache] = useState<Map<string, LessonWithObjectives[]>>(new Map())
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(initialSelectedTeacherId ?? currentTeacherId)
  const [lessonScores, setLessonScores] = useState<Map<string, number | null>>(new Map())
```

Do not change anything else in this file — every handler (`handlePrevWeek`, `handleNextWeek`, the teacher `<select>` dropdown's `onChange`, all write actions) stays exactly as-is. This task only changes how the two state variables get their *initial* value.

- [ ] **Step 3: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: no new errors beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`. Do NOT run `npm run build` — check first with `lsof -nP -iTCP:3000 -sTCP:LISTEN`; if a dev server is listening, skip the build entirely and rely on `tsc --noEmit`.

- [ ] **Step 4: Self-review**

`git diff src/app/teacher-planner/page.tsx src/components/teacher-planner/TeacherPlannerClient.tsx` — confirm: `page.tsx` gains `searchParams` param and two new props passed through; `TeacherPlannerClient.tsx` gains two new optional props used only in the two `useState` initializers; nothing else in either file touched.

- [ ] **Step 5: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/app/teacher-planner/page.tsx src/components/teacher-planner/TeacherPlannerClient.tsx
git commit -m "Seed Teacher Planner initial week/teacher from URL params"
```

---

### Task 2: Thread week ISO date and teacher id through the SoW components

**Files:**
- Modify: `src/components/sow/SowWeekList.tsx`
- Modify: `src/app/sow/[groupId]/sow-client.tsx`
- Modify: `src/app/sow/[groupId]/page.tsx`

Current full content of `src/components/sow/SowWeekList.tsx`:

```tsx
'use client'

import { SowWeekRow } from './SowWeekRow'
import type { HalfTerm, Unit } from '@/types'
import type { SowWeekLesson } from '@/lib/server-updates'

type Props = {
  groupId: string
  halfTerms: HalfTerm[]
  lessons: SowWeekLesson[]
  units: Unit[]
}

function toLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatWeekLabel(weekStart: Date, weekNum: number): string {
  const end = addDays(weekStart, 4)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `Week ${weekNum} · ${fmt(weekStart)} – ${fmt(end)}`
}

export function SowWeekList({ groupId, halfTerms, lessons, units }: Props) {
  if (halfTerms.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)] mt-4">
        Half terms are not configured. Ask an admin to set up H1–H6 dates.
      </p>
    )
  }

  const unitMap = new Map(units.map((u) => [u.unit_id, u.title]))

  const sortedHT = [...halfTerms].sort((a, b) => a.name.localeCompare(b.name))
  const yearStart = toLocalDate(sortedHT[0].start_date)
  const yearEnd = toLocalDate(sortedHT[sortedHT.length - 1].end_date)

  const weekToHt = new Map<string, string>()
  for (const ht of sortedHT) {
    let cur = toLocalDate(ht.start_date)
    cur.setDate(cur.getDate() - cur.getDay())
    const end = toLocalDate(ht.end_date)
    while (cur <= end) {
      weekToHt.set(toIsoDate(cur), ht.name)
      cur = addDays(cur, 7)
    }
  }

  const lessonsByWeek = new Map<string, SowWeekLesson[]>()
  for (const l of lessons) {
    const arr = lessonsByWeek.get(l.week_start_date) ?? []
    arr.push(l)
    lessonsByWeek.set(l.week_start_date, arr)
  }

  const weeks: Date[] = []
  let cur = new Date(yearStart)
  cur.setDate(cur.getDate() - cur.getDay())
  while (cur <= yearEnd) {
    weeks.push(new Date(cur))
    cur = addDays(cur, 7)
  }

  let weekNum = 0
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] whitespace-nowrap w-48">Date</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] w-48">Unit</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)]">Lesson</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--color-text-secondary)] w-16">Score</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--color-text-secondary)]">Learning Objectives</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((weekStart) => {
            const iso = toIsoDate(weekStart)
            const htName = weekToHt.get(iso)
            const weekLessons = lessonsByWeek.get(iso) ?? []
            if (htName) weekNum++
            return (
              <SowWeekRow
                key={iso}
                groupId={groupId}
                weekLabel={formatWeekLabel(weekStart, weekNum)}
                halfTermBadge={htName ?? ''}
                isHoliday={!htName}
                lessons={weekLessons}
                unitMap={unitMap}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 1: Update `SowWeekList.tsx`**

Change the `Props` type:

```ts
type Props = {
  groupId: string
  halfTerms: HalfTerm[]
  lessons: SowWeekLesson[]
  units: Unit[]
  teacherId: string
}
```

Change the function signature:

```ts
export function SowWeekList({ groupId, halfTerms, lessons, units, teacherId }: Props) {
```

Change the `<SowWeekRow>` call site (inside the `weeks.map` block) to add `weekStartIso` and `teacherId`:

```tsx
            return (
              <SowWeekRow
                key={iso}
                groupId={groupId}
                weekLabel={formatWeekLabel(weekStart, weekNum)}
                weekStartIso={iso}
                teacherId={teacherId}
                halfTermBadge={htName ?? ''}
                isHoliday={!htName}
                lessons={weekLessons}
                unitMap={unitMap}
              />
            )
```

No other change to this file.

- [ ] **Step 2: Update `SowWeekRow.tsx`**

Current full content:

```tsx
import { Fragment } from 'react'
import Link from 'next/link'
import type { SowWeekLesson } from '@/lib/server-updates'

type Props = {
  groupId: string
  weekLabel: string
  halfTermBadge: string
  isHoliday: boolean
  lessons: SowWeekLesson[]
  unitMap: Map<string, string>
}

const BADGE_COLOURS: Record<string, string> = {
  H1: 'bg-blue-100 text-blue-700',
  H2: 'bg-green-100 text-green-700',
  H3: 'bg-yellow-100 text-yellow-700',
  H4: 'bg-orange-100 text-orange-700',
  H5: 'bg-purple-100 text-purple-700',
  H6: 'bg-pink-100 text-pink-700',
}

export function SowWeekRow({ groupId, weekLabel, halfTermBadge, isHoliday, lessons, unitMap }: Props) {
  const badge = halfTermBadge ? (
    <span className={`inline-block rounded text-center text-xs font-semibold px-1.5 py-0.5 ${BADGE_COLOURS[halfTermBadge] ?? ''}`}>
      {halfTermBadge}
    </span>
  ) : null

  if (isHoliday) {
    return (
      <tr className="opacity-40">
        <td className="px-3 py-1.5 text-xs text-[var(--color-text-tertiary)] whitespace-nowrap" colSpan={5}>
          {weekLabel} · Holiday
        </td>
      </tr>
    )
  }

  if (lessons.length === 0) {
    return (
      <tr className="border-t border-[var(--color-border)]">
        <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)] whitespace-nowrap align-top">
          <div className="flex items-center gap-1.5">{badge}<span>{weekLabel}</span></div>
        </td>
        <td className="px-3 py-2" colSpan={4} />
      </tr>
    )
  }

  return (
    <Fragment>
      {lessons.map((l, i) => (
        <tr key={l.lesson_id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]">
          {i === 0 ? (
            <td
              className="px-3 py-2 text-xs text-[var(--color-text-secondary)] whitespace-nowrap align-top"
              rowSpan={lessons.length}
            >
              <div className="flex items-center gap-1.5">{badge}<span>{weekLabel}</span></div>
            </td>
          ) : null}
          <td className="px-3 py-2 text-sm align-top">
            <Link
              href={`/units/${encodeURIComponent(l.unit_id)}`}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline"
            >
              {unitMap.get(l.unit_id) ?? ''}
            </Link>
          </td>
          <td className="px-3 py-2 text-sm align-top">
            <Link
              href={`/lessons/${encodeURIComponent(l.lesson_id)}`}
              className="text-[var(--color-text-primary)] hover:underline"
            >
              {l.lesson_title}
            </Link>
          </td>
          <td className="px-3 py-2 text-sm text-right align-top tabular-nums">
            <Link
              href={`/unit-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(l.unit_id)}`}
              className={typeof l.score === 'number' ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}
              title="View results"
            >
              {typeof l.score === 'number' ? `${l.score}%` : '--'}
            </Link>
          </td>
          <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)] align-top">
            {l.los.join(', ')}
          </td>
        </tr>
      ))}
    </Fragment>
  )
}
```

Replace the entire file with:

```tsx
import { Fragment } from 'react'
import Link from 'next/link'
import type { SowWeekLesson } from '@/lib/server-updates'

type Props = {
  groupId: string
  weekLabel: string
  weekStartIso: string
  teacherId: string
  halfTermBadge: string
  isHoliday: boolean
  lessons: SowWeekLesson[]
  unitMap: Map<string, string>
}

const BADGE_COLOURS: Record<string, string> = {
  H1: 'bg-blue-100 text-blue-700',
  H2: 'bg-green-100 text-green-700',
  H3: 'bg-yellow-100 text-yellow-700',
  H4: 'bg-orange-100 text-orange-700',
  H5: 'bg-purple-100 text-purple-700',
  H6: 'bg-pink-100 text-pink-700',
}

export function SowWeekRow({ groupId, weekLabel, weekStartIso, teacherId, halfTermBadge, isHoliday, lessons, unitMap }: Props) {
  const badge = halfTermBadge ? (
    <span className={`inline-block rounded text-center text-xs font-semibold px-1.5 py-0.5 ${BADGE_COLOURS[halfTermBadge] ?? ''}`}>
      {halfTermBadge}
    </span>
  ) : null

  const weekLink = (
    <Link
      href={`/teacher-planner?week=${weekStartIso}&teacherId=${encodeURIComponent(teacherId)}`}
      className="hover:underline"
    >
      {weekLabel}
    </Link>
  )

  if (isHoliday) {
    return (
      <tr className="opacity-40">
        <td className="px-3 py-1.5 text-xs text-[var(--color-text-tertiary)] whitespace-nowrap" colSpan={5}>
          {weekLink} · Holiday
        </td>
      </tr>
    )
  }

  if (lessons.length === 0) {
    return (
      <tr className="border-t border-[var(--color-border)]">
        <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)] whitespace-nowrap align-top">
          <div className="flex items-center gap-1.5">{badge}{weekLink}</div>
        </td>
        <td className="px-3 py-2" colSpan={4} />
      </tr>
    )
  }

  return (
    <Fragment>
      {lessons.map((l, i) => (
        <tr key={l.lesson_id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]">
          {i === 0 ? (
            <td
              className="px-3 py-2 text-xs text-[var(--color-text-secondary)] whitespace-nowrap align-top"
              rowSpan={lessons.length}
            >
              <div className="flex items-center gap-1.5">{badge}{weekLink}</div>
            </td>
          ) : null}
          <td className="px-3 py-2 text-sm align-top">
            <Link
              href={`/units/${encodeURIComponent(l.unit_id)}`}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline"
            >
              {unitMap.get(l.unit_id) ?? ''}
            </Link>
          </td>
          <td className="px-3 py-2 text-sm align-top">
            <Link
              href={`/lessons/${encodeURIComponent(l.lesson_id)}`}
              className="text-[var(--color-text-primary)] hover:underline"
            >
              {l.lesson_title}
            </Link>
          </td>
          <td className="px-3 py-2 text-sm text-right align-top tabular-nums">
            <Link
              href={`/unit-progress-reports/${encodeURIComponent(groupId)}/${encodeURIComponent(l.unit_id)}`}
              className={typeof l.score === 'number' ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}
              title="View results"
            >
              {typeof l.score === 'number' ? `${l.score}%` : '--'}
            </Link>
          </td>
          <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)] align-top">
            {l.los.join(', ')}
          </td>
        </tr>
      ))}
    </Fragment>
  )
}
```

(Summary: `weekStartIso`/`teacherId` added to `Props`; a single `weekLink` element is built once and reused in all three render branches — holiday, no-lessons, has-lessons — replacing the plain `<span>{weekLabel}</span>` / bare `{weekLabel}` text in each. `teacherId` is always required, not optional, since `SowWeekList`/the page always has a resolved value to pass — no conditional `?` query-string branching needed.)

- [ ] **Step 3: Update `src/app/sow/[groupId]/sow-client.tsx`**

Current full content:

```tsx
'use client'

import { useState } from 'react'
import { SowHalfTermTable } from '@/components/sow/SowHalfTermTable'
import { SowWeekList } from '@/components/sow/SowWeekList'
import type { HalfTerm, SowHalfTermUnit, Unit } from '@/types'
import type { SowWeekLesson } from '@/lib/server-updates'

type YearData = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  lessons: SowWeekLesson[]
}

type Props = {
  groupId: string
  groupName: string
  availableYears: number[]
  initialYear: number
  initialData: YearData
  units: Unit[]
  onYearChange: (year: number) => Promise<YearData>
}

export function SowClient({
  groupId,
  groupName,
  availableYears,
  initialYear,
  initialData,
  units,
  onYearChange,
}: Props) {
  const [year, setYear] = useState(initialYear)
  const [dataByYear, setDataByYear] = useState<Record<number, YearData>>({
    [initialYear]: initialData,
  })

  const currentData = dataByYear[year] ?? initialData

  async function handleYearChange(newYear: number) {
    setYear(newYear)
    if (dataByYear[newYear]) return
    const result = await onYearChange(newYear)
    setDataByYear((prev) => ({ ...prev, [newYear]: result }))
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium text-[var(--color-text-primary)]">
          {groupName} — Scheme of Work
        </h1>
        <select
          value={year}
          onChange={(e) => handleYearChange(Number(e.target.value))}
          className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 py-1 text-[var(--color-text-primary)]"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}/{String(y + 1).slice(2)}</option>
          ))}
        </select>
      </div>

      <SowHalfTermTable
        key={`ht-${year}`}
        halfTerms={currentData.halfTerms}
        htUnits={currentData.htUnits}
      />

      <SowWeekList
        key={`wl-${year}`}
        groupId={groupId}
        halfTerms={currentData.halfTerms}
        lessons={currentData.lessons}
        units={units}
      />
    </>
  )
}
```

Change the `Props` type to add `teacherId: string`:

```ts
type Props = {
  groupId: string
  groupName: string
  availableYears: number[]
  initialYear: number
  initialData: YearData
  units: Unit[]
  teacherId: string
  onYearChange: (year: number) => Promise<YearData>
}
```

Change the function signature:

```ts
export function SowClient({
  groupId,
  groupName,
  availableYears,
  initialYear,
  initialData,
  units,
  teacherId,
  onYearChange,
}: Props) {
```

Change the `<SowWeekList>` call site to add `teacherId={teacherId}`:

```tsx
      <SowWeekList
        key={`wl-${year}`}
        groupId={groupId}
        halfTerms={currentData.halfTerms}
        lessons={currentData.lessons}
        units={units}
        teacherId={teacherId}
      />
```

No other change to this file.

- [ ] **Step 4: Update `src/app/sow/[groupId]/page.tsx`**

Current relevant lines:

```tsx
  return (
    <main className="max-w-5xl mx-auto p-8">
      <SowClient
        groupId={groupId}
        groupName={`${groupId} · ${group.subject ?? ''}`}
        availableYears={years}
        initialYear={year}
        initialData={initialData}
        units={units}
        onYearChange={onYearChange}
      />
    </main>
  )
```

Change to add `teacherId={targetTeacherId}` (the page already computes `targetTeacherId` earlier in the function, from `?teacherId=` or the caller's own id):

```tsx
  return (
    <main className="max-w-5xl mx-auto p-8">
      <SowClient
        groupId={groupId}
        groupName={`${groupId} · ${group.subject ?? ''}`}
        availableYears={years}
        initialYear={year}
        initialData={initialData}
        units={units}
        teacherId={targetTeacherId}
        onYearChange={onYearChange}
      />
    </main>
  )
```

No other change to this file.

- [ ] **Step 5: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: ZERO new errors — only the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`. This confirms Task 1 and Task 2 compile cleanly together. Do NOT run `npm run build` if a dev server is listening on port 3000 (check with `lsof -nP -iTCP:3000 -sTCP:LISTEN` first).

- [ ] **Step 6: Self-review**

`git diff src/components/sow/SowWeekList.tsx src/components/sow/SowWeekRow.tsx "src/app/sow/[groupId]/sow-client.tsx" "src/app/sow/[groupId]/page.tsx"` — confirm: `teacherId`/`weekStartIso` threaded through exactly as described in each file; the `weekLink` element replaces the plain label in all three `SowWeekRow` render branches; no other logic touched (the year-switcher, the half-term table, the lesson/unit/score links all stay as they are).

- [ ] **Step 7: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/components/sow/SowWeekList.tsx src/components/sow/SowWeekRow.tsx "src/app/sow/[groupId]/sow-client.tsx" "src/app/sow/[groupId]/page.tsx"
git commit -m "Link SoW week dates to the corresponding Teacher Planner week"
```

---

### Task 3: Manual end-to-end verification

**No files changed in this task — verification only.**

- [ ] **Step 1: Start the dev server (if not already running)**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run dev`

- [ ] **Step 2: Verify links from your own SoW page**

1. Sign in as a teacher with at least one class that has lessons scheduled across a few different weeks (use data from prior verification passes if available).
2. Navigate to `/sow/<your-group-id>`.
3. Click a week label for a week that has lessons — confirm the URL becomes `/teacher-planner?week=<that-week's-iso-date>&teacherId=<your-own-id>` and the planner grid shows exactly that week, with yourself selected in the teacher dropdown (since `?teacherId=` matches your own id, this should look identical to not having the param at all).
4. Go back, click a week label for a week with no lessons scheduled (but within a half-term) — confirm it navigates correctly to that week too.
5. Go back, click a holiday-week label (greyed-out row, outside any half-term) — confirm it also navigates to that week (decided: holiday weeks link too, no special-casing).

- [ ] **Step 3: Verify links from an admin viewing another teacher's SoW**

1. Sign in as an admin.
2. Navigate to `/sow`, select a different teacher from the dropdown, click into one of their classes (lands on `/sow/<group-id>?teacherId=<that-teacher-id>`).
3. Click a week label on that page — confirm the resulting `/teacher-planner` URL carries that teacher's id (not your own admin id), and the planner's teacher dropdown shows that teacher selected, not yourself.

- [ ] **Step 4: Verify normal Teacher Planner navigation is unaffected**

1. On `/teacher-planner` (reached normally, with no query params — e.g. via the nav menu), confirm it still defaults to today's week and yourself, exactly as before this change.
2. Use the prev/next week arrows and switch the teacher dropdown — confirm the URL does NOT change during this navigation (no `?week=`/`?teacherId=` ever gets added to the address bar from in-page interaction, only from an incoming link).
