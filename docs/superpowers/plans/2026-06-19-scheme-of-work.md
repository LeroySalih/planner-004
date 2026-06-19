# Scheme of Work (SoW) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Scheme of Work feature — a per-class, per-academic-year curriculum map showing units per half term and lessons per week — sharing lesson data with the existing teacher-planner.

**Architecture:** Three new DB tables (`half_terms`, `sow_lesson_plan`, `sow_half_term_units`) provide the data backbone. `sow_lesson_plan` is dual-written by both the SoW and teacher-planner surfaces. The SoW is a new `/sow` route with a class-listing landing page and a per-class detail page with a half-term overview table and week-by-week lesson list. Admin pages get a half-term date configuration section.

**Tech Stack:** Next.js 15 App Router, React 19 server/client components, PostgreSQL via `pg`, Zod, Tailwind CSS v4, Radix UI primitives, `sonner` toasts, `server-updates.ts` re-export barrel.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/migrations/20260619_sow_tables.sql` | Create | Three new tables + indexes |
| `src/lib/server-actions/sow.ts` | Create | All SoW server actions |
| `src/lib/server-actions/planner-assignments.ts` | Modify | Dual-write to `sow_lesson_plan` |
| `src/lib/server-updates.ts` | Modify | Re-export new SoW actions |
| `src/types/index.ts` | Modify | Zod schemas for new types |
| `src/app/sow/page.tsx` | Create | Landing page (server) |
| `src/app/sow/[groupId]/page.tsx` | Create | SoW detail page (server) |
| `src/app/sow/[groupId]/sow-client.tsx` | Create | Client component |
| `src/components/sow/SowHalfTermTable.tsx` | Create | 2×6 half-term overview |
| `src/components/sow/SowWeekList.tsx` | Create | Week-by-week section |
| `src/components/sow/SowWeekRow.tsx` | Create | Single week row |
| `src/components/sow/SowLessonPicker.tsx` | Create | Unit → lesson two-step picker |
| `src/components/navigation/side-nav.tsx` | Modify | Point SoW nav link to `/sow` |
| `src/app/admin/half-terms/page.tsx` | Create | Admin half-term config page |
| `src/components/admin/HalfTermManager.tsx` | Create | Half-term CRUD client |

---

## Task 1: DB Migration — three new tables

**Files:**
- Create: `src/migrations/20260619_sow_tables.sql`

- [ ] **Step 1: Write migration**

```sql
-- src/migrations/20260619_sow_tables.sql

CREATE TABLE IF NOT EXISTS half_terms (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  year       integer NOT NULL,
  name       text    NOT NULL CHECK (name IN ('H1','H2','H3','H4','H5','H6')),
  start_date date    NOT NULL,
  end_date   date    NOT NULL,
  UNIQUE (year, name)
);

CREATE TABLE IF NOT EXISTS sow_lesson_plan (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        text        NOT NULL REFERENCES groups(group_id),
  lesson_id       text        NOT NULL REFERENCES lessons(lesson_id),
  unit_id         text        NOT NULL,
  week_start_date date        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, lesson_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_sow_lesson_plan_group_week
  ON sow_lesson_plan (group_id, week_start_date);

CREATE TABLE IF NOT EXISTS sow_half_term_units (
  group_id     text    NOT NULL REFERENCES groups(group_id),
  half_term_id uuid    NOT NULL REFERENCES half_terms(id) ON DELETE CASCADE,
  unit_id      text    NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, half_term_id, unit_id)
);
```

- [ ] **Step 2: Apply migration**

```bash
psql $DATABASE_URL -f src/migrations/20260619_sow_tables.sql
```

Expected: no errors, three `CREATE TABLE` / `CREATE INDEX` confirmations.

- [ ] **Step 3: Commit**

```bash
git add src/migrations/20260619_sow_tables.sql
git commit -m "feat(sow): add half_terms, sow_lesson_plan, sow_half_term_units tables"
```

---

## Task 2: Zod schemas for new types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add schemas at the bottom of the existing type definitions**

Find the end of the exported schemas in `src/types/index.ts` and append:

```ts
export const HalfTermSchema = z.object({
  id: z.string(),
  year: z.number(),
  name: z.enum(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']),
  start_date: z.string(), // ISO date string YYYY-MM-DD
  end_date: z.string(),
})
export type HalfTerm = z.infer<typeof HalfTermSchema>

export const SowLessonPlanSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  lesson_id: z.string(),
  unit_id: z.string(),
  week_start_date: z.string(),
  created_at: z.string(),
})
export type SowLessonPlan = z.infer<typeof SowLessonPlanSchema>

export const SowHalfTermUnitSchema = z.object({
  group_id: z.string(),
  half_term_id: z.string(),
  unit_id: z.string(),
  unit_name: z.string().optional(), // joined from units table
  position: z.number(),
})
export type SowHalfTermUnit = z.infer<typeof SowHalfTermUnitSchema>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | grep -E "error TS|SowLesson|HalfTerm" | head -20
```

Expected: no TS errors related to the new schemas.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(sow): add HalfTerm, SowLessonPlan, SowHalfTermUnit Zod schemas"
```

---

## Task 3: SoW server actions

**Files:**
- Create: `src/lib/server-actions/sow.ts`
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Create `src/lib/server-actions/sow.ts`**

```ts
'use server'

import { z } from 'zod'
import { query } from '@/lib/db'
import { requireTeacherProfile } from '@/lib/auth'
import { HalfTermSchema, SowLessonPlanSchema, SowHalfTermUnitSchema } from '@/types'

// ── Return shapes ─────────────────────────────────────────────────────────────

const HalfTermsResult = z.object({
  data: z.array(HalfTermSchema).nullable(),
  error: z.string().nullable(),
})

const HalfTermResult = z.object({
  data: HalfTermSchema.nullable(),
  error: z.string().nullable(),
})

const SowLessonPlanResult = z.object({
  data: z.array(SowLessonPlanSchema).nullable(),
  error: z.string().nullable(),
})

const SowHalfTermUnitsResult = z.object({
  data: z.array(SowHalfTermUnitSchema).nullable(),
  error: z.string().nullable(),
})

const NullResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIsoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

// ── Half term actions ─────────────────────────────────────────────────────────

export async function readHalfTermsAction(year: number): Promise<z.infer<typeof HalfTermsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, year, name, start_date, end_date
       FROM half_terms
       WHERE year = $1
       ORDER BY name`,
      [year],
    )
    const data = rows.map((r) =>
      HalfTermSchema.parse({
        ...r,
        start_date: toIsoDate(r.start_date),
        end_date: toIsoDate(r.end_date),
      }),
    )
    return HalfTermsResult.parse({ data, error: null })
  } catch (e) {
    return HalfTermsResult.parse({ data: null, error: String(e) })
  }
}

export async function upsertHalfTermAction(
  year: number,
  name: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6',
  startDate: string,
  endDate: string,
): Promise<z.infer<typeof HalfTermResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `INSERT INTO half_terms (year, name, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (year, name)
       DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
       RETURNING id, year, name, start_date, end_date`,
      [year, name, startDate, endDate],
    )
    const data = HalfTermSchema.parse({
      ...rows[0],
      start_date: toIsoDate(rows[0].start_date),
      end_date: toIsoDate(rows[0].end_date),
    })
    return HalfTermResult.parse({ data, error: null })
  } catch (e) {
    return HalfTermResult.parse({ data: null, error: String(e) })
  }
}

// ── SoW half-term units ───────────────────────────────────────────────────────

export async function readSowHalfTermUnitsAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowHalfTermUnitsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT shu.group_id, shu.half_term_id, shu.unit_id, u.subject AS unit_name, shu.position
       FROM sow_half_term_units shu
       JOIN half_terms ht ON ht.id = shu.half_term_id
       LEFT JOIN units u ON u.unit_id = shu.unit_id
       WHERE shu.group_id = $1 AND ht.year = $2
       ORDER BY ht.name, shu.position`,
      [groupId, year],
    )
    const data = rows.map((r) => SowHalfTermUnitSchema.parse(r))
    return SowHalfTermUnitsResult.parse({ data, error: null })
  } catch (e) {
    return SowHalfTermUnitsResult.parse({ data: null, error: String(e) })
  }
}

export async function addSowHalfTermUnitAction(
  groupId: string,
  halfTermId: string,
  unitId: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    const { rows: existing } = await query<{ position: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS position
       FROM sow_half_term_units
       WHERE group_id = $1 AND half_term_id = $2`,
      [groupId, halfTermId],
    )
    const position = existing[0]?.position ?? 0
    await query(
      `INSERT INTO sow_half_term_units (group_id, half_term_id, unit_id, position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [groupId, halfTermId, unitId, position],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

export async function removeSowHalfTermUnitAction(
  groupId: string,
  halfTermId: string,
  unitId: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    await query(
      `DELETE FROM sow_half_term_units
       WHERE group_id = $1 AND half_term_id = $2 AND unit_id = $3`,
      [groupId, halfTermId, unitId],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

// ── SoW lesson plan ───────────────────────────────────────────────────────────

export async function readSowLessonPlanAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowLessonPlanResult>> {
  try {
    await requireTeacherProfile()
    // Fetch lessons for all weeks covered by H1 start → H6 end for this year
    const { rows } = await query<Record<string, unknown>>(
      `SELECT slp.id, slp.group_id, slp.lesson_id, slp.unit_id,
              slp.week_start_date, slp.created_at
       FROM sow_lesson_plan slp
       JOIN half_terms h1 ON h1.year = $2 AND h1.name = 'H1'
       JOIN half_terms h6 ON h6.year = $2 AND h6.name = 'H6'
       WHERE slp.group_id = $1
         AND slp.week_start_date BETWEEN h1.start_date AND h6.end_date
       ORDER BY slp.week_start_date`,
      [groupId, year],
    )
    const data = rows.map((r) =>
      SowLessonPlanSchema.parse({
        ...r,
        week_start_date: toIsoDate(r.week_start_date),
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }),
    )
    return SowLessonPlanResult.parse({ data, error: null })
  } catch (e) {
    return SowLessonPlanResult.parse({ data: null, error: String(e) })
  }
}

export async function addSowLessonAction(
  groupId: string,
  lessonId: string,
  unitId: string,
  weekStartDate: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    await query(
      `INSERT INTO sow_lesson_plan (group_id, lesson_id, unit_id, week_start_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, lesson_id, week_start_date) DO NOTHING`,
      [groupId, lessonId, unitId, weekStartDate],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

export async function removeSowLessonAction(
  groupId: string,
  lessonId: string,
  weekStartDate: string,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    await query(
      `DELETE FROM sow_lesson_plan
       WHERE group_id = $1 AND lesson_id = $2 AND week_start_date = $3`,
      [groupId, lessonId, weekStartDate],
    )
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}

// ── Teacher groups (for /sow landing page) ────────────────────────────────────

const TeacherGroupSchema = z.object({
  group_id: z.string(),
  subject: z.string(),
})

const TeacherGroupsResult = z.object({
  data: z.array(TeacherGroupSchema).nullable(),
  error: z.string().nullable(),
})

export async function readTeacherGroupsForSowAction(): Promise<z.infer<typeof TeacherGroupsResult>> {
  try {
    const profile = await requireTeacherProfile()
    // Groups where this teacher has a timetable slot assigned
    const { rows } = await query<{ group_id: string; subject: string }>(
      `SELECT DISTINCT g.group_id, g.subject
       FROM timetable_slot_groups tsg
       JOIN groups g ON g.group_id = tsg.group_id
       WHERE tsg.teacher_id = $1 AND g.active = true
       ORDER BY g.subject`,
      [profile.userId],
    )
    return TeacherGroupsResult.parse({ data: rows, error: null })
  } catch (e) {
    return TeacherGroupsResult.parse({ data: null, error: String(e) })
  }
}
```

- [ ] **Step 2: Re-export from `src/lib/server-updates.ts`**

Add at the end of `src/lib/server-updates.ts`:

```ts
export {
  readHalfTermsAction,
  upsertHalfTermAction,
  readSowHalfTermUnitsAction,
  addSowHalfTermUnitAction,
  removeSowHalfTermUnitAction,
  readSowLessonPlanAction,
  addSowLessonAction,
  removeSowLessonAction,
  readTeacherGroupsForSowAction,
} from './server-actions/sow'
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/sow.ts src/lib/server-updates.ts
git commit -m "feat(sow): add SoW server actions and re-exports"
```

---

## Task 4: Dual-write in planner-assignments actions

**Files:**
- Modify: `src/lib/server-actions/planner-assignments.ts`

- [ ] **Step 1: Add dual-write to `upsertPlannerAssignmentAction`**

In `src/lib/server-actions/planner-assignments.ts`, find `upsertPlannerAssignmentAction`. After the `INSERT INTO planner_assignments ... RETURNING *` query succeeds, add the `sow_lesson_plan` upsert. The `unit_id` comes from the lessons table:

```ts
// Inside upsertPlannerAssignmentAction, after the planner_assignments INSERT succeeds:
// Dual-write to sow_lesson_plan
const { rows: lessonRows } = await query<{ unit_id: string }>(
  `SELECT l.unit_id
   FROM lessons l
   JOIN units u ON u.unit_id = l.unit_id
   WHERE l.lesson_id = $1
   LIMIT 1`,
  [lessonId],
)
if (lessonRows[0]?.unit_id) {
  await query(
    `INSERT INTO sow_lesson_plan (group_id, lesson_id, unit_id, week_start_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, lesson_id, week_start_date) DO NOTHING`,
    [groupId, lessonId, lessonRows[0].unit_id, weekStartDate],
  )
}
```

- [ ] **Step 2: Add dual-write to `deletePlannerAssignmentAction`**

Find `deletePlannerAssignmentAction`. After the DELETE on `planner_assignments`, add:

```ts
// Dual-write: only remove from sow_lesson_plan if no other planner slots
// reference this lesson+group+week (there may be multiple day/period slots)
await query(
  `DELETE FROM sow_lesson_plan
   WHERE group_id = $1 AND lesson_id = $2 AND week_start_date = $3
     AND NOT EXISTS (
       SELECT 1 FROM planner_assignments
       WHERE group_id = $1 AND lesson_id = $2 AND week_start_date = $3
     )`,
  [groupId, lessonId, weekStartDate],
)
```

Note: `deletePlannerAssignmentAction`'s existing signature must include `weekStartDate`. Check its current signature and add the parameter if missing. The existing call sites in `TeacherPlannerClient.tsx` pass `week` as the fourth argument — confirm this is the `week_start_date` ISO string.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/planner-assignments.ts
git commit -m "feat(sow): dual-write sow_lesson_plan from planner-assignment upsert/delete"
```

---

## Task 5: Navigation — point SoW link to `/sow`

**Files:**
- Modify: `src/components/navigation/side-nav.tsx`

- [ ] **Step 1: Update the nav link**

In `src/components/navigation/side-nav.tsx` line 156, change:

```tsx
<NavLink href="/assignments" onNavigate={onNavigate}>SoW</NavLink>
```

to:

```tsx
<NavLink href="/sow" onNavigate={onNavigate}>SoW</NavLink>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/navigation/side-nav.tsx
git commit -m "feat(sow): update nav link to /sow"
```

---

## Task 6: `/sow` landing page

**Files:**
- Create: `src/app/sow/page.tsx`

- [ ] **Step 1: Create the landing page**

```tsx
// src/app/sow/page.tsx
import Link from 'next/link'
import { requireTeacherProfile } from '@/lib/auth'
import { readTeacherGroupsForSowAction, readHalfTermsAction } from '@/lib/server-updates'

function currentAcademicYear(): number {
  const now = new Date()
  // Academic year starts in September
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

export default async function SowLandingPage() {
  await requireTeacherProfile()

  const year = currentAcademicYear()
  const [groupsResult, halfTermsResult] = await Promise.all([
    readTeacherGroupsForSowAction(),
    readHalfTermsAction(year),
  ])

  const groups = groupsResult.data ?? []
  const halfTerms = halfTermsResult.data ?? []
  const plannedCount = halfTerms.length

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-medium text-[var(--color-text-primary)] mb-6">
        Schemes of Work — {year}/{String(year + 1).slice(2)}
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
              <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
                {plannedCount}/6 half terms configured
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Start dev server and verify page loads**

```bash
pnpm dev
```

Open `http://localhost:3000/sow` — expect to see class cards or the empty-state message.

- [ ] **Step 3: Commit**

```bash
git add src/app/sow/page.tsx
git commit -m "feat(sow): add /sow landing page with class cards"
```

---

## Task 7: `SowHalfTermTable` component

**Files:**
- Create: `src/components/sow/SowHalfTermTable.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/sow/SowHalfTermTable.tsx
'use client'

import { useState } from 'react'
import { addSowHalfTermUnitAction, removeSowHalfTermUnitAction } from '@/lib/server-updates'
import { toast } from 'sonner'
import type { HalfTerm, SowHalfTermUnit, Unit } from '@/types'

const HALF_TERM_NAMES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

type Props = {
  groupId: string
  halfTerms: HalfTerm[]   // up to 6, for the selected year
  htUnits: SowHalfTermUnit[]
  units: Unit[]
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

export function SowHalfTermTable({ groupId, halfTerms, htUnits, units }: Props) {
  const [localHtUnits, setLocalHtUnits] = useState<SowHalfTermUnit[]>(htUnits)
  const [adding, setAdding] = useState<string | null>(null) // halfTermId being added to

  const halfTermMap = new Map(halfTerms.map((ht) => [ht.name, ht]))

  async function handleAdd(halfTermId: string, unitId: string) {
    const { error } = await addSowHalfTermUnitAction(groupId, halfTermId, unitId)
    if (error) { toast.error('Failed to add unit'); return }
    const unit = units.find((u) => u.unit_id === unitId)
    setLocalHtUnits((prev) => [
      ...prev,
      { group_id: groupId, half_term_id: halfTermId, unit_id: unitId, unit_name: unit?.subject, position: prev.filter(u => u.half_term_id === halfTermId).length },
    ])
    setAdding(null)
  }

  async function handleRemove(halfTermId: string, unitId: string) {
    const { error } = await removeSowHalfTermUnitAction(groupId, halfTermId, unitId)
    if (error) { toast.error('Failed to remove unit'); return }
    setLocalHtUnits((prev) => prev.filter((u) => !(u.half_term_id === halfTermId && u.unit_id === unitId)))
  }

  return (
    <div className="overflow-x-auto mb-8">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {HALF_TERM_NAMES.map((name) => {
              const ht = halfTermMap.get(name)
              return (
                <th
                  key={name}
                  className="border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-2 text-left font-semibold text-[var(--color-text-primary)] w-[16.66%]"
                >
                  <div>{name}</div>
                  {ht && (
                    <div className="text-xs font-normal text-[var(--color-text-secondary)]">
                      {formatDateRange(ht.start_date, ht.end_date)}
                    </div>
                  )}
                  {!ht && (
                    <div className="text-xs font-normal text-[var(--color-text-tertiary)]">Not configured</div>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            {HALF_TERM_NAMES.map((name) => {
              const ht = halfTermMap.get(name)
              const cellUnits = ht
                ? localHtUnits.filter((u) => u.half_term_id === ht.id).sort((a, b) => a.position - b.position)
                : []
              const usedUnitIds = new Set(cellUnits.map((u) => u.unit_id))

              return (
                <td
                  key={name}
                  className="border border-[var(--color-border)] bg-[var(--color-background-primary)] px-3 py-2 align-top"
                >
                  <div className="flex flex-col gap-1">
                    {cellUnits.map((cu) => (
                      <span
                        key={cu.unit_id}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-xs"
                      >
                        {cu.unit_name ?? cu.unit_id}
                        {ht && (
                          <button
                            onClick={() => handleRemove(ht.id, cu.unit_id)}
                            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] ml-0.5"
                            aria-label={`Remove ${cu.unit_name}`}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    ))}
                    {ht && adding === ht.id && (
                      <select
                        autoFocus
                        className="text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-1 py-0.5 mt-1"
                        defaultValue=""
                        onChange={(e) => e.target.value && handleAdd(ht.id, e.target.value)}
                        onBlur={() => setAdding(null)}
                      >
                        <option value="" disabled>Select unit…</option>
                        {units
                          .filter((u) => !usedUnitIds.has(u.unit_id))
                          .map((u) => (
                            <option key={u.unit_id} value={u.unit_id}>{u.subject}</option>
                          ))}
                      </select>
                    )}
                    {ht && adding !== ht.id && (
                      <button
                        onClick={() => setAdding(ht.id)}
                        className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-left mt-0.5"
                      >
                        + Add unit
                      </button>
                    )}
                  </div>
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sow/SowHalfTermTable.tsx
git commit -m "feat(sow): add SowHalfTermTable component"
```

---

## Task 8: `SowLessonPicker` component

**Files:**
- Create: `src/components/sow/SowLessonPicker.tsx`

- [ ] **Step 1: Create the picker**

```tsx
// src/components/sow/SowLessonPicker.tsx
'use client'

import { useState } from 'react'
import type { Unit, LessonWithObjectives } from '@/types'
import { readLessonsByUnitAction } from '@/lib/server-updates'

type Props = {
  units: Unit[]
  onSelect: (lessonId: string, unitId: string, lessonTitle: string) => void
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
    const { data } = await readLessonsByUnitAction(unitId)
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
              onClick={() => onSelect(l.lesson_id, selectedUnitId, l.title)}
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sow/SowLessonPicker.tsx
git commit -m "feat(sow): add SowLessonPicker two-step unit→lesson picker"
```

---

## Task 9: `SowWeekRow` and `SowWeekList` components

**Files:**
- Create: `src/components/sow/SowWeekRow.tsx`
- Create: `src/components/sow/SowWeekList.tsx`

- [ ] **Step 1: Create `SowWeekRow`**

```tsx
// src/components/sow/SowWeekRow.tsx
'use client'

import { useState } from 'react'
import { addSowLessonAction, removeSowLessonAction } from '@/lib/server-updates'
import { SowLessonPicker } from './SowLessonPicker'
import { toast } from 'sonner'
import type { SowLessonPlan, Unit } from '@/types'

type Props = {
  groupId: string
  weekStartDate: string   // YYYY-MM-DD
  weekLabel: string       // "Week N · DD Mon – DD Mon"
  halfTermBadge: string   // "H1" | "H2" | … | "" for holiday
  isHoliday: boolean
  lessons: SowLessonPlan[]
  units: Unit[]
  lessonTitleMap: Map<string, string>  // lesson_id → title
  onLessonsChange: (weekStartDate: string, lessons: SowLessonPlan[]) => void
}

export function SowWeekRow({
  groupId,
  weekStartDate,
  weekLabel,
  halfTermBadge,
  isHoliday,
  lessons,
  units,
  lessonTitleMap,
  onLessonsChange,
}: Props) {
  const [showPicker, setShowPicker] = useState(false)

  async function handleAdd(lessonId: string, unitId: string) {
    const { error } = await addSowLessonAction(groupId, lessonId, unitId, weekStartDate)
    if (error) { toast.error('Failed to add lesson'); return }
    const newLesson: SowLessonPlan = {
      id: crypto.randomUUID(),
      group_id: groupId,
      lesson_id: lessonId,
      unit_id: unitId,
      week_start_date: weekStartDate,
      created_at: new Date().toISOString(),
    }
    onLessonsChange(weekStartDate, [...lessons, newLesson])
    setShowPicker(false)
  }

  async function handleRemove(lessonId: string) {
    const { error } = await removeSowLessonAction(groupId, lessonId, weekStartDate)
    if (error) { toast.error('Failed to remove lesson'); return }
    onLessonsChange(weekStartDate, lessons.filter((l) => l.lesson_id !== lessonId))
  }

  if (isHoliday) {
    return (
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg opacity-40 text-sm">
        <span className="w-8 text-center text-xs font-medium text-[var(--color-text-tertiary)]">—</span>
        <span className="text-[var(--color-text-tertiary)]">{weekLabel} · Holiday</span>
      </div>
    )
  }

  const badgeColours: Record<string, string> = {
    H1: 'bg-blue-100 text-blue-700',
    H2: 'bg-green-100 text-green-700',
    H3: 'bg-yellow-100 text-yellow-700',
    H4: 'bg-orange-100 text-orange-700',
    H5: 'bg-purple-100 text-purple-700',
    H6: 'bg-pink-100 text-pink-700',
  }

  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-[var(--color-background-secondary)] group">
      <span
        className={`mt-0.5 w-8 shrink-0 rounded text-center text-xs font-semibold px-1 py-0.5 ${badgeColours[halfTermBadge] ?? ''}`}
      >
        {halfTermBadge}
      </span>

      <div className="flex-1">
        <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">{weekLabel}</p>
        <ul className="flex flex-col gap-0.5">
          {lessons.map((l) => (
            <li key={l.lesson_id} className="flex items-center gap-1 text-sm text-[var(--color-text-primary)]">
              <span>• {lessonTitleMap.get(l.lesson_id) ?? l.lesson_id}</span>
              <button
                onClick={() => handleRemove(l.lesson_id)}
                className="opacity-0 group-hover:opacity-100 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-xs"
                aria-label="Remove lesson"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>

        {showPicker ? (
          <SowLessonPicker
            units={units}
            onSelect={(lessonId, unitId) => handleAdd(lessonId, unitId)}
            onCancel={() => setShowPicker(false)}
          />
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] mt-1 opacity-0 group-hover:opacity-100"
          >
            + Add lesson
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `SowWeekList`**

```tsx
// src/components/sow/SowWeekList.tsx
'use client'

import { useState } from 'react'
import { SowWeekRow } from './SowWeekRow'
import type { HalfTerm, SowLessonPlan, Unit } from '@/types'

type Props = {
  groupId: string
  halfTerms: HalfTerm[]
  initialLessons: SowLessonPlan[]
  units: Unit[]
  lessonTitleMap: Map<string, string>
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
  const end = addDays(weekStart, 4) // Thu
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `Week ${weekNum} · ${fmt(weekStart)} – ${fmt(end)}`
}

export function SowWeekList({ groupId, halfTerms, initialLessons, units, lessonTitleMap }: Props) {
  const [lessonsByWeek, setLessonsByWeek] = useState<Map<string, SowLessonPlan[]>>(() => {
    const map = new Map<string, SowLessonPlan[]>()
    for (const l of initialLessons) {
      const arr = map.get(l.week_start_date) ?? []
      arr.push(l)
      map.set(l.week_start_date, arr)
    }
    return map
  })

  if (halfTerms.length < 2) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)] mt-4">
        Half terms are not fully configured. Ask an admin to set up H1–H6 dates.
      </p>
    )
  }

  const sortedHT = [...halfTerms].sort((a, b) => a.name.localeCompare(b.name))
  const yearStart = toLocalDate(sortedHT[0].start_date)
  const yearEnd = toLocalDate(sortedHT[sortedHT.length - 1].end_date)

  // Build a map from ISO week-start → half-term name
  const weekToHt = new Map<string, string>()
  for (const ht of sortedHT) {
    let cur = toLocalDate(ht.start_date)
    // Snap to Sunday
    cur.setDate(cur.getDate() - cur.getDay())
    const end = toLocalDate(ht.end_date)
    while (cur <= end) {
      weekToHt.set(toIsoDate(cur), ht.name)
      cur = addDays(cur, 7)
    }
  }

  // Generate all week starts from year start (snapped to Sunday) to year end
  const weeks: Date[] = []
  let cur = new Date(yearStart)
  cur.setDate(cur.getDate() - cur.getDay())
  while (cur <= yearEnd) {
    weeks.push(new Date(cur))
    cur = addDays(cur, 7)
  }

  function handleLessonsChange(weekStartDate: string, updated: SowLessonPlan[]) {
    setLessonsByWeek((prev) => {
      const next = new Map(prev)
      next.set(weekStartDate, updated)
      return next
    })
  }

  return (
    <div className="flex flex-col">
      {weeks.map((weekStart, i) => {
        const iso = toIsoDate(weekStart)
        const htName = weekToHt.get(iso)
        const lessons = lessonsByWeek.get(iso) ?? []
        return (
          <SowWeekRow
            key={iso}
            groupId={groupId}
            weekStartDate={iso}
            weekLabel={formatWeekLabel(weekStart, i + 1)}
            halfTermBadge={htName ?? ''}
            isHoliday={!htName}
            lessons={lessons}
            units={units}
            lessonTitleMap={lessonTitleMap}
            onLessonsChange={handleLessonsChange}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sow/SowWeekRow.tsx src/components/sow/SowWeekList.tsx
git commit -m "feat(sow): add SowWeekRow and SowWeekList components"
```

---

## Task 10: SoW detail page

**Files:**
- Create: `src/app/sow/[groupId]/page.tsx`
- Create: `src/app/sow/[groupId]/sow-client.tsx`

- [ ] **Step 1: Create `sow-client.tsx`**

```tsx
// src/app/sow/[groupId]/sow-client.tsx
'use client'

import { useState } from 'react'
import { SowHalfTermTable } from '@/components/sow/SowHalfTermTable'
import { SowWeekList } from '@/components/sow/SowWeekList'
import type { HalfTerm, SowHalfTermUnit, SowLessonPlan, Unit } from '@/types'

type LessonMeta = { lesson_id: string; title: string }

type Props = {
  groupId: string
  groupName: string
  availableYears: number[]
  initialYear: number
  halfTermsByYear: Record<number, HalfTerm[]>
  htUnitsByYear: Record<number, SowHalfTermUnit[]>
  lessonPlansByYear: Record<number, SowLessonPlan[]>
  units: Unit[]
  lessonMetas: LessonMeta[]
  onYearChange: (year: number) => Promise<{
    halfTerms: HalfTerm[]
    htUnits: SowHalfTermUnit[]
    lessonPlans: SowLessonPlan[]
  }>
}

export function SowClient({
  groupId,
  groupName,
  availableYears,
  initialYear,
  halfTermsByYear,
  htUnitsByYear,
  lessonPlansByYear,
  units,
  lessonMetas,
  onYearChange,
}: Props) {
  const [year, setYear] = useState(initialYear)
  const [dataByYear, setDataByYear] = useState({
    halfTerms: halfTermsByYear,
    htUnits: htUnitsByYear,
    lessonPlans: lessonPlansByYear,
  })

  const lessonTitleMap = new Map(lessonMetas.map((l) => [l.lesson_id, l.title]))

  async function handleYearChange(newYear: number) {
    setYear(newYear)
    if (dataByYear.halfTerms[newYear]) return // already loaded
    const result = await onYearChange(newYear)
    setDataByYear((prev) => ({
      halfTerms: { ...prev.halfTerms, [newYear]: result.halfTerms },
      htUnits: { ...prev.htUnits, [newYear]: result.htUnits },
      lessonPlans: { ...prev.lessonPlans, [newYear]: result.lessonPlans },
    }))
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
        groupId={groupId}
        halfTerms={dataByYear.halfTerms[year] ?? []}
        htUnits={dataByYear.htUnits[year] ?? []}
        units={units}
      />

      <SowWeekList
        groupId={groupId}
        halfTerms={dataByYear.halfTerms[year] ?? []}
        initialLessons={dataByYear.lessonPlans[year] ?? []}
        units={units}
        lessonTitleMap={lessonTitleMap}
      />
    </>
  )
}
```

- [ ] **Step 2: Create `src/app/sow/[groupId]/page.tsx`**

```tsx
// src/app/sow/[groupId]/page.tsx
import { requireTeacherProfile } from '@/lib/auth'
import {
  readHalfTermsAction,
  readSowHalfTermUnitsAction,
  readSowLessonPlanAction,
  readTeacherGroupsForSowAction,
  readUnitsAction,
  readLessonsByUnitAction,
} from '@/lib/server-updates'
import { SowClient } from './sow-client'
import { notFound } from 'next/navigation'
import type { HalfTerm, SowHalfTermUnit, SowLessonPlan } from '@/types'

function currentAcademicYear(): number {
  const now = new Date()
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

function availableYears(): number[] {
  const current = currentAcademicYear()
  return [current - 1, current, current + 1]
}

export default async function SowDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  await requireTeacherProfile()

  const year = currentAcademicYear()
  const years = availableYears()

  const [groupsResult, unitsResult, halfTermsResult, htUnitsResult, lessonPlanResult] = await Promise.all([
    readTeacherGroupsForSowAction(),
    readUnitsAction(),
    readHalfTermsAction(year),
    readSowHalfTermUnitsAction(groupId, year),
    readSowLessonPlanAction(groupId, year),
  ])

  const group = (groupsResult.data ?? []).find((g) => g.group_id === groupId)
  if (!group) notFound()

  const units = unitsResult.data ?? []
  const lessonPlans = lessonPlanResult.data ?? []

  // Fetch lesson titles for all lessons referenced in the plan
  const uniqueUnitIds = [...new Set(lessonPlans.map((l) => l.unit_id))]
  const lessonsByUnit = await Promise.all(uniqueUnitIds.map((uid) => readLessonsByUnitAction(uid)))
  const lessonMetas = lessonsByUnit.flatMap((r) =>
    (r.data ?? []).map((l) => ({ lesson_id: l.lesson_id, title: l.title })),
  )

  async function onYearChange(newYear: number): Promise<{
    halfTerms: HalfTerm[]
    htUnits: SowHalfTermUnit[]
    lessonPlans: SowLessonPlan[]
  }> {
    'use server'
    const [ht, htu, lp] = await Promise.all([
      readHalfTermsAction(newYear),
      readSowHalfTermUnitsAction(groupId, newYear),
      readSowLessonPlanAction(groupId, newYear),
    ])
    return {
      halfTerms: ht.data ?? [],
      htUnits: htu.data ?? [],
      lessonPlans: lp.data ?? [],
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-8">
      <SowClient
        groupId={groupId}
        groupName={`${groupId} — ${group.subject}`}
        availableYears={years}
        initialYear={year}
        halfTermsByYear={{ [year]: halfTermsResult.data ?? [] }}
        htUnitsByYear={{ [year]: htUnitsResult.data ?? [] }}
        lessonPlansByYear={{ [year]: lessonPlans }}
        units={units}
        lessonMetas={lessonMetas}
        onYearChange={onYearChange}
      />
    </main>
  )
}
```

- [ ] **Step 3: Verify the page loads**

```bash
pnpm dev
```

Open `http://localhost:3000/sow` → click a class card → expect to see the half-term table and week list (empty if no half terms configured yet).

- [ ] **Step 4: Commit**

```bash
git add src/app/sow/[groupId]/page.tsx src/app/sow/[groupId]/sow-client.tsx
git commit -m "feat(sow): add /sow/[groupId] detail page"
```

---

## Task 11: Admin — half-term configuration

**Files:**
- Create: `src/app/admin/half-terms/page.tsx`
- Create: `src/components/admin/HalfTermManager.tsx`

- [ ] **Step 1: Create `HalfTermManager` client component**

```tsx
// src/components/admin/HalfTermManager.tsx
'use client'

import { useState } from 'react'
import { upsertHalfTermAction } from '@/lib/server-updates'
import { toast } from 'sonner'
import type { HalfTerm } from '@/types'

const NAMES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

type Props = {
  year: number
  initialHalfTerms: HalfTerm[]
}

export function HalfTermManager({ year, initialHalfTerms }: Props) {
  const [halfTerms, setHalfTerms] = useState<HalfTerm[]>(initialHalfTerms)
  const [saving, setSaving] = useState<string | null>(null)

  function getValue(name: string, field: 'start_date' | 'end_date'): string {
    return halfTerms.find((ht) => ht.name === name)?.[field] ?? ''
  }

  function handleChange(name: string, field: 'start_date' | 'end_date', value: string) {
    setHalfTerms((prev) => {
      const existing = prev.find((ht) => ht.name === name)
      if (existing) {
        return prev.map((ht) => ht.name === name ? { ...ht, [field]: value } : ht)
      }
      return [...prev, { id: '', year, name: name as HalfTerm['name'], start_date: '', end_date: '', [field]: value }]
    })
  }

  async function handleSave(name: typeof NAMES[number]) {
    const ht = halfTerms.find((h) => h.name === name)
    if (!ht?.start_date || !ht?.end_date) { toast.error('Set both dates before saving'); return }
    setSaving(name)
    const { error, data } = await upsertHalfTermAction(year, name, ht.start_date, ht.end_date)
    setSaving(null)
    if (error) { toast.error(`Failed to save ${name}`); return }
    if (data) {
      setHalfTerms((prev) => prev.map((h) => h.name === name ? data : h))
    }
    toast.success(`${name} saved`)
  }

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">{year}/{String(year + 1).slice(2)} Half Terms</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NAMES.map((name) => (
          <div
            key={name}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4 space-y-2"
          >
            <p className="font-medium text-sm">{name}</p>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              Start
              <input
                type="date"
                value={getValue(name, 'start_date')}
                onChange={(e) => handleChange(name, 'start_date', e.target.value)}
                className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1 text-sm"
              />
            </label>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              End
              <input
                type="date"
                value={getValue(name, 'end_date')}
                onChange={(e) => handleChange(name, 'end_date', e.target.value)}
                className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-[var(--color-background-primary)] px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={() => handleSave(name)}
              disabled={saving === name}
              className="text-xs rounded bg-[var(--color-brand)] text-white px-3 py-1 hover:opacity-90 disabled:opacity-50"
            >
              {saving === name ? 'Saving…' : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create admin page**

```tsx
// src/app/admin/half-terms/page.tsx
import { requireRole } from '@/lib/auth'
import { readHalfTermsAction } from '@/lib/server-updates'
import { HalfTermManager } from '@/components/admin/HalfTermManager'

function currentAcademicYear(): number {
  const now = new Date()
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

export default async function AdminHalfTermsPage() {
  await requireRole('admin')

  const year = currentAcademicYear()
  const { data: halfTerms } = await readHalfTermsAction(year)

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Half Term Configuration</h1>
      <HalfTermManager year={year} initialHalfTerms={halfTerms ?? []} />
    </div>
  )
}
```

- [ ] **Step 3: Add link in admin layout or admin index**

In `src/app/admin/roles/page.tsx` (or wherever admin links live), add a link to `/admin/half-terms`. Alternatively add it to the admin nav. Find the admin index page (`src/app/admin/page.tsx` if it exists) and add:

```tsx
<Link href="/admin/half-terms">Half Terms</Link>
```

- [ ] **Step 4: Verify admin page loads at `http://localhost:3000/admin/half-terms`**

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/half-terms/page.tsx src/components/admin/HalfTermManager.tsx
git commit -m "feat(sow): add admin half-term configuration page"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Configure half terms in admin**

Go to `http://localhost:3000/admin/half-terms`, set dates for H1–H6 for the current academic year, save each.

- [ ] **Step 2: Open SoW landing page**

Go to `http://localhost:3000/sow` — confirm your classes appear.

- [ ] **Step 3: Open a class SoW**

Click a class card — confirm the half-term table shows the configured units row (empty initially) and the week list shows weeks grouped by half term with holiday weeks collapsed.

- [ ] **Step 4: Add a unit to a half term**

Click "+ Add unit" in an H1 cell → select a unit → confirm the chip appears.

- [ ] **Step 5: Add a lesson to a week**

Hover over a week row → click "+ Add lesson" → select a unit → select a lesson → confirm it appears in the week row.

- [ ] **Step 6: Verify lesson appears in teacher-planner after planning it there**

In `/teacher-planner`, assign a lesson for the same class in a week. Go back to the SoW — confirm that lesson now appears in the correct week row (dual-write working).

- [ ] **Step 7: Commit (if any fixes made)**

```bash
git add -p
git commit -m "fix(sow): smoke test fixes"
```
