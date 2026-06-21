# Admin Teacher Dropdown on SoW Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins pick a teacher from a dropdown on `/sow` to view and fully edit that teacher's Scheme of Work, carrying the choice through to `/sow/[groupId]` via a `?teacherId=` query param.

**Architecture:** Mirror the Teacher Planner admin-edit pattern already in this codebase: a server page computes `isAdmin` and fetches the teacher list, a small client component owns the dropdown's selection state, and the read action that scopes "which classes belong to this teacher" gains an optional target-teacher parameter gated by the existing `requireTeacherOrAdminAccess` helper.

**Tech Stack:** Next.js server actions + server/client components, PostgreSQL (`pg` via `query()`), Zod for action result validation.

**Testing note:** As with the Teacher Planner feature, this repo has no unit/integration test runner for server actions — only Playwright E2E (`npm test`), not wired for this kind of permission-matrix testing. Each task ends with a manual verification step. Task 4 is the end-to-end manual pass.

---

### Task 1: Add `targetTeacherId` to `readTeacherGroupsForSowAction`

**Files:**
- Modify: `src/lib/server-actions/sow.ts:1-6` (imports), `:179-194` (function)

Current function:

```ts
export async function readTeacherGroupsForSowAction(): Promise<z.infer<typeof TeacherGroupsResult>> {
  try {
    const profile = await requireTeacherProfile()
    const { rows } = await query<{ group_id: string; subject: string }>(
      `SELECT DISTINCT g.group_id, g.subject
       FROM timetable_slot_groups tsg
       JOIN groups g ON g.group_id = tsg.group_id
       WHERE tsg.teacher_id = $1 AND g.active IS NOT FALSE
       ORDER BY g.subject`,
      [profile.userId],
    )
    return TeacherGroupsResult.parse({ data: rows, error: null })
  } catch (e) {
    return TeacherGroupsResult.parse({ data: null, error: String(e) })
  }
}
```

- [ ] **Step 1: Update the import line**

Change line 5 from:
```ts
import { requireTeacherProfile, requireRole } from '@/lib/auth'
```
to:
```ts
import { requireTeacherProfile, requireRole, requireTeacherOrAdminAccess } from '@/lib/auth'
```

- [ ] **Step 2: Add the optional parameter and authorization gate**

Replace the function with:

```ts
export async function readTeacherGroupsForSowAction(
  targetTeacherId?: string,
): Promise<z.infer<typeof TeacherGroupsResult>> {
  try {
    const profile = await requireTeacherProfile()
    const resolvedTargetTeacherId = targetTeacherId ?? profile.userId
    await requireTeacherOrAdminAccess(resolvedTargetTeacherId)
    const { rows } = await query<{ group_id: string; subject: string }>(
      `SELECT DISTINCT g.group_id, g.subject
       FROM timetable_slot_groups tsg
       JOIN groups g ON g.group_id = tsg.group_id
       WHERE tsg.teacher_id = $1 AND g.active IS NOT FALSE
       ORDER BY g.subject`,
      [resolvedTargetTeacherId],
    )
    return TeacherGroupsResult.parse({ data: rows, error: null })
  } catch (e) {
    return TeacherGroupsResult.parse({ data: null, error: String(e) })
  }
}
```

Do not change any other function in this file (`readHalfTermsAction`, `upsertHalfTermAction`, `readSowHalfTermUnitsAction`, `addSowHalfTermUnitAction`, `removeSowHalfTermUnitAction`, `assignHalfTermUnitsToGroupsAction` all stay untouched — they have no group-ownership check today and that's an accepted pre-existing gap, out of scope here).

- [ ] **Step 3: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`
Expected: existing two callers of `readTeacherGroupsForSowAction()` (in `src/app/sow/page.tsx` and `src/app/sow/[groupId]/page.tsx`) still compile fine since the new param is optional — no new errors beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/lib/server-actions/sow.ts
git commit -m "Authorize readTeacherGroupsForSowAction for admin-on-behalf-of viewing"
```

---

### Task 2: Split `/sow` landing page into server page + client dropdown component

**Files:**
- Modify: `src/app/sow/page.tsx`
- Create: `src/components/sow/SowLandingClient.tsx`

Current `src/app/sow/page.tsx`:

```tsx
import Link from 'next/link'
import { requireTeacherProfile } from '@/lib/auth'
import { readTeacherGroupsForSowAction } from '@/lib/server-updates'
import { currentAcademicYear, academicYearLabel } from '@/lib/academic-year'

export default async function SowLandingPage() {
  await requireTeacherProfile()

  const year = currentAcademicYear()
  const groupsResult = await readTeacherGroupsForSowAction()

  const groups = groupsResult.data ?? []

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-medium text-[var(--color-text-primary)] mb-6">
        Schemes of Work — {academicYearLabel(year)}
      </h1>

      {groups.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No classes found. Set up your timetable in the Weekly Planner first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.group_id}
              href={`/sow/${g.group_id}`}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-5 hover:bg-[var(--color-background-tertiary)] transition-colors"
            >
              <p className="font-medium text-[var(--color-text-primary)]">{g.group_id}</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">{g.subject}</p>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
```

`TeacherGroup` type (for reference, from `src/types`) has shape `{ group_id: string; subject: string }`.

- [ ] **Step 1: Create the client component**

Create `src/components/sow/SowLandingClient.tsx`:

```tsx
'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { readTeacherGroupsForSowAction } from '@/lib/server-updates'
import type { TeacherGroup } from '@/types'

type SowLandingClientProps = {
  initialGroups: TeacherGroup[]
  teachers: { userId: string; firstName: string | null; lastName: string | null }[]
  currentTeacherId: string
  isAdmin: boolean
}

export function SowLandingClient({ initialGroups, teachers, currentTeacherId, isAdmin }: SowLandingClientProps) {
  const [selectedTeacherId, setSelectedTeacherId] = useState(currentTeacherId)
  const [groups, setGroups] = useState<TeacherGroup[]>(initialGroups)

  const loadGroupsForTeacher = useCallback(async (teacherId: string) => {
    const result = await readTeacherGroupsForSowAction(teacherId)
    setGroups(result.data ?? [])
  }, [])

  return (
    <>
      {isAdmin && (
        <div className="mb-6">
          <select
            value={selectedTeacherId}
            onChange={(e) => {
              const teacherId = e.target.value
              setSelectedTeacherId(teacherId)
              loadGroupsForTeacher(teacherId)
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
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No classes found. Set up your timetable in the Weekly Planner first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.group_id}
              href={selectedTeacherId === currentTeacherId ? `/sow/${g.group_id}` : `/sow/${g.group_id}?teacherId=${selectedTeacherId}`}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-5 hover:bg-[var(--color-background-tertiary)] transition-colors"
            >
              <p className="font-medium text-[var(--color-text-primary)]">{g.group_id}</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">{g.subject}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Update the page to fetch teachers and delegate to the client component**

Replace the entire content of `src/app/sow/page.tsx` with:

```tsx
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { readTeacherGroupsForSowAction, readTeachersAction } from '@/lib/server-updates'
import { currentAcademicYear, academicYearLabel } from '@/lib/academic-year'
import { SowLandingClient } from '@/components/sow/SowLandingClient'

export default async function SowLandingPage() {
  const profile = await requireTeacherProfile()
  const isAdmin = hasRole(profile, 'admin')

  const year = currentAcademicYear()
  const [groupsResult, teachersResult] = await Promise.all([
    readTeacherGroupsForSowAction(),
    isAdmin ? readTeachersAction() : Promise.resolve({ data: [], error: null }),
  ])

  const groups = groupsResult.data ?? []

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-medium text-[var(--color-text-primary)] mb-6">
        Schemes of Work — {academicYearLabel(year)}
      </h1>
      <SowLandingClient
        initialGroups={groups}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
      />
    </main>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`
Expected: no new errors beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`.

- [ ] **Step 4: Build**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run build`
Expected: build succeeds.

**Do NOT run `npm run dev` and `npm run build` at the same time in this project** — they share the `.next/` directory and running both concurrently corrupts the dev server's build manifest (this happened earlier in this project and caused a client-side crash after the dev server sat idle). If a dev server is already running in the background for manual testing, skip this build step or stop the dev server first, run the build, then restart dev.

- [ ] **Step 5: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/app/sow/page.tsx src/components/sow/SowLandingClient.tsx
git commit -m "Add admin teacher dropdown to SoW landing page"
```

---

### Task 3: Carry `?teacherId=` through to `/sow/[groupId]`

**Files:**
- Modify: `src/app/sow/[groupId]/page.tsx`

Current content:

```tsx
import { requireTeacherProfile } from '@/lib/auth'
import { query } from '@/lib/db'
import {
  readHalfTermsAction,
  readSowHalfTermUnitsAction,
  readGroupSowLessonsAction,
  readTeacherGroupsForSowAction,
  readUnitsAction,
} from '@/lib/server-updates'
import type { SowWeekLesson } from '@/lib/server-updates'
import { SowClient } from './sow-client'
import { notFound } from 'next/navigation'
import { currentAcademicYear, fetchActiveAcademicYears } from '@/lib/academic-year'
import type { HalfTerm, SowHalfTermUnit, Unit, TeacherGroup } from '@/types'

type YearData = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  lessons: SowWeekLesson[]
}

async function fetchYearData(groupId: string, year: number): Promise<YearData> {
  const [ht, htu, lp] = await Promise.all([
    readHalfTermsAction(year),
    readSowHalfTermUnitsAction(groupId, year),
    readGroupSowLessonsAction(groupId, year),
  ])
  return {
    halfTerms: ht.data ?? [],
    htUnits: htu.data ?? [],
    lessons: lp.data ?? [],
  }
}

export default async function SowDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  await requireTeacherProfile()

  const year = currentAcademicYear()
  const years = await fetchActiveAcademicYears()

  const [groupsResult, unitsResult, initialData] = await Promise.all([
    readTeacherGroupsForSowAction(),
    readUnitsAction(),
    fetchYearData(groupId, year),
  ])

  const group = (groupsResult.data ?? []).find((g) => g.group_id === groupId)
  if (!group) notFound()

  const units: Unit[] = unitsResult.data ?? []
  const allGroups: TeacherGroup[] = (groupsResult.data ?? []).filter((g) => g.group_id !== groupId)

  async function onYearChange(newYear: number): Promise<YearData> {
    'use server'
    const profile = await requireTeacherProfile()
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM timetable_slot_groups WHERE teacher_id = $1 AND group_id = $2`,
      [profile.userId, groupId],
    )
    if (Number(rows[0]?.count ?? 0) === 0) {
      throw new Error('Unauthorized: group does not belong to this teacher')
    }
    return fetchYearData(groupId, newYear)
  }

  return (
    <main className="max-w-5xl mx-auto p-8">
      <SowClient
        groupId={groupId}
        groupName={`${groupId} · ${group.subject ?? ''}`}
        availableYears={years}
        initialYear={year}
        initialData={initialData}
        units={units}
        allGroups={allGroups}
        onYearChange={onYearChange}
      />
    </main>
  )
}
```

- [ ] **Step 1: Replace the file content**

Replace the entire file with:

```tsx
import { requireTeacherProfile, requireTeacherOrAdminAccess } from '@/lib/auth'
import { query } from '@/lib/db'
import {
  readHalfTermsAction,
  readSowHalfTermUnitsAction,
  readGroupSowLessonsAction,
  readTeacherGroupsForSowAction,
  readUnitsAction,
} from '@/lib/server-updates'
import type { SowWeekLesson } from '@/lib/server-updates'
import { SowClient } from './sow-client'
import { notFound } from 'next/navigation'
import { currentAcademicYear, fetchActiveAcademicYears } from '@/lib/academic-year'
import type { HalfTerm, SowHalfTermUnit, Unit, TeacherGroup } from '@/types'

type YearData = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  lessons: SowWeekLesson[]
}

async function fetchYearData(groupId: string, year: number): Promise<YearData> {
  const [ht, htu, lp] = await Promise.all([
    readHalfTermsAction(year),
    readSowHalfTermUnitsAction(groupId, year),
    readGroupSowLessonsAction(groupId, year),
  ])
  return {
    halfTerms: ht.data ?? [],
    htUnits: htu.data ?? [],
    lessons: lp.data ?? [],
  }
}

export default async function SowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{ teacherId?: string }>
}) {
  const { groupId } = await params
  const { teacherId } = await searchParams
  const profile = await requireTeacherProfile()
  const targetTeacherId = teacherId ?? profile.userId
  await requireTeacherOrAdminAccess(targetTeacherId)

  const year = currentAcademicYear()
  const years = await fetchActiveAcademicYears()

  const [groupsResult, unitsResult, initialData] = await Promise.all([
    readTeacherGroupsForSowAction(targetTeacherId),
    readUnitsAction(),
    fetchYearData(groupId, year),
  ])

  const group = (groupsResult.data ?? []).find((g) => g.group_id === groupId)
  if (!group) notFound()

  const units: Unit[] = unitsResult.data ?? []
  const allGroups: TeacherGroup[] = (groupsResult.data ?? []).filter((g) => g.group_id !== groupId)

  async function onYearChange(newYear: number): Promise<YearData> {
    'use server'
    await requireTeacherOrAdminAccess(targetTeacherId)
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM timetable_slot_groups WHERE teacher_id = $1 AND group_id = $2`,
      [targetTeacherId, groupId],
    )
    if (Number(rows[0]?.count ?? 0) === 0) {
      throw new Error('Unauthorized: group does not belong to this teacher')
    }
    return fetchYearData(groupId, newYear)
  }

  return (
    <main className="max-w-5xl mx-auto p-8">
      <SowClient
        groupId={groupId}
        groupName={`${groupId} · ${group.subject ?? ''}`}
        availableYears={years}
        initialYear={year}
        initialData={initialData}
        units={units}
        allGroups={allGroups}
        onYearChange={onYearChange}
      />
    </main>
  )
}
```

(Only changes from the original: the import line gains `requireTeacherOrAdminAccess`; the component signature gains `searchParams`; `targetTeacherId` is resolved and authorized right after `requireTeacherProfile()`; both calls that previously used `profile.userId` for "which teacher" now use `targetTeacherId`; `readTeacherGroupsForSowAction()` is called with `targetTeacherId`. `SowClient` and its props are completely unchanged — confirmed during design that it needs no new prop, since it never builds navigation links itself.)

- [ ] **Step 2: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`
Expected: no new errors beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`.

- [ ] **Step 3: Build**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run build`
Expected: build succeeds. (Same caution as Task 2 Step 4 — don't run this concurrently with a live `npm run dev`.)

- [ ] **Step 4: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/app/sow/[groupId]/page.tsx
git commit -m "Carry admin-selected teacherId through to SoW detail page"
```

---

### Task 4: Manual end-to-end verification

**No files changed in this task — verification only.**

- [ ] **Step 1: Start the dev server (if not already running)**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run dev`

- [ ] **Step 2: Verify admin can view and edit another teacher's SoW**

1. Sign in as a user with the `admin` role.
2. Navigate to `/sow`.
3. Confirm the teacher dropdown appears above the class grid.
4. Select a different teacher — confirm the class grid updates to show that teacher's classes (different from your own).
5. Click into one of their classes — confirm the URL is `/sow/<groupId>?teacherId=<that-teacher-id>` and the page loads (no 404).
6. Confirm you can add a unit to a half-term, remove one, and change the academic year selector — all without errors.
7. Navigate back to `/sow`, re-select yourself (or the "(me)" option) — confirm your own classes show and links have no `?teacherId=` param.

- [ ] **Step 3: Verify non-admin behavior is unchanged**

1. Sign in as a regular teacher (no `admin` role).
2. Navigate to `/sow` — confirm there is no teacher dropdown, and your own classes show exactly as before this change.
3. Click into one of your classes — confirm `/sow/<groupId>` works with no `?teacherId=` param, exactly as before.

- [ ] **Step 4: Verify server-side rejection of tampered access**

1. While signed in as the non-admin teacher from Step 3, manually edit the URL to `/sow/<some-groupId>?teacherId=<a-different-teachers-id>` (use a class you know isn't yours).
2. Confirm the page does not load the foreign teacher's data — it should error out (via the thrown `"Not authorized to edit this teacher's planner"` from `requireTeacherOrAdminAccess`, surfaced through Next's error boundary) rather than silently showing their SoW.
