# SoW Half-Term Grid Derived From Planner Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SoW half-term grid a read-only summary of units actually scheduled via the Teacher Planner, instead of a manually-edited table, removing the now-redundant add/remove/assign-to-other-classes controls.

**Architecture:** Rewrite `readSowHalfTermUnitsAction`'s query to derive units from `planner_assignments` → `lessons` → `units`, bucketed by half-term date range and ordered by earliest scheduled lesson date. Delete the three manual-edit server actions. Strip `SowHalfTermTable` down to a read-only render. Update the two callers to stop threading the now-unused `allGroups`/mutation props through.

**Tech Stack:** Next.js server actions, PostgreSQL (`pg` via `query()`), Zod, React (server component page + client component for year-switching state).

**Testing note:** No unit/integration test runner exists for server actions in this repo (confirmed across every prior feature in this codebase). Verification is manual; Task 5 is the end-to-end pass.

---

### Task 1: Rewrite `readSowHalfTermUnitsAction`, delete the three manual-edit actions

**Files:**
- Modify: `src/lib/server-actions/sow.ts:81-170`

Current content (the full block to replace):

```ts
export async function readSowHalfTermUnitsAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowHalfTermUnitsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT shu.group_id, shu.half_term_id, shu.unit_id, u.title AS unit_name, shu.position
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

export async function assignHalfTermUnitsToGroupsAction(
  sourceGroupId: string,
  targetGroupIds: string[],
  year: number,
): Promise<z.infer<typeof NullResult>> {
  try {
    await requireTeacherProfile()
    if (targetGroupIds.length === 0) return NullResult.parse({ data: null, error: null })
    for (const targetGroupId of targetGroupIds) {
      await query(
        `INSERT INTO sow_half_term_units (group_id, half_term_id, unit_id, position)
         SELECT $2, shu.half_term_id, shu.unit_id, shu.position
         FROM sow_half_term_units shu
         JOIN half_terms ht ON ht.id = shu.half_term_id
         WHERE shu.group_id = $1 AND ht.year = $3
         ON CONFLICT DO NOTHING`,
        [sourceGroupId, targetGroupId, year],
      )
    }
    return NullResult.parse({ data: null, error: null })
  } catch (e) {
    return NullResult.parse({ data: null, error: String(e) })
  }
}
```

- [ ] **Step 1: Replace the whole block**

Replace all four functions above with just this one function (same name, same signature, same return type — so nothing calling it needs to change):

```ts
export async function readSowHalfTermUnitsAction(
  groupId: string,
  year: number,
): Promise<z.infer<typeof SowHalfTermUnitsResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT g.half_term_id, g.unit_id, u.title AS unit_name,
              (ROW_NUMBER() OVER (PARTITION BY g.half_term_id ORDER BY g.first_week) - 1) AS position
       FROM (
         SELECT ht.id AS half_term_id, l.unit_id, MIN(pa.week_start_date) AS first_week
         FROM planner_assignments pa
         JOIN lessons l ON l.lesson_id = pa.lesson_id
         JOIN half_terms ht ON ht.year = $2 AND pa.week_start_date BETWEEN ht.start_date AND ht.end_date
         WHERE pa.group_id = $1
         GROUP BY ht.id, l.unit_id
       ) g
       LEFT JOIN units u ON u.unit_id = g.unit_id
       ORDER BY g.half_term_id, position`,
      [groupId, year],
    )
    const data = rows.map((r) =>
      SowHalfTermUnitSchema.parse({ ...r, group_id: groupId, position: Number(r.position) }),
    )
    return SowHalfTermUnitsResult.parse({ data, error: null })
  } catch (e) {
    return SowHalfTermUnitsResult.parse({ data: null, error: String(e) })
  }
}
```

Leave everything else in the file untouched — `HalfTermsResult`, `HalfTermResult`, `SowHalfTermUnitsResult`, `NullResult` type declarations stay (`NullResult` is still used elsewhere in this file, e.g. by `upsertHalfTermAction`), `readHalfTermsAction`, `upsertHalfTermAction`, `readTeacherGroupsForSowAction` are not touched.

- [ ] **Step 2: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: new errors will appear at every caller of the three deleted functions (`addSowHalfTermUnitAction`, `removeSowHalfTermUnitAction`, `assignHalfTermUnitsToGroupsAction`) — specifically in `src/lib/server-updates.ts` (re-export) and `src/components/sow/SowHalfTermTable.tsx` (the calls). This is EXPECTED — Task 2 and Task 3 fix those. Beyond that, no new errors should appear beyond the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts`. Do NOT run `npm run build` (a `npm run dev` server may be running in the background for this project; concurrent builds corrupt the shared `.next/` directory).

- [ ] **Step 3: Self-review**

`git diff src/lib/server-actions/sow.ts` — confirm the diff is exactly: the four functions replaced by one, nothing else in the file touched.

- [ ] **Step 4: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/lib/server-actions/sow.ts
git commit -m "Derive SoW half-term units from planner assignments, drop manual editing"
```

---

### Task 2: Remove dead re-exports from `server-updates.ts`

**Files:**
- Modify: `src/lib/server-updates.ts:380-387`

Current block:

```ts
export {
  readHalfTermsAction,
  upsertHalfTermAction,
  readSowHalfTermUnitsAction,
  addSowHalfTermUnitAction,
  removeSowHalfTermUnitAction,
  assignHalfTermUnitsToGroupsAction,
  readTeacherGroupsForSowAction,
} from './server-actions/sow'
```

- [ ] **Step 1: Remove the three dead lines**

Change to:

```ts
export {
  readHalfTermsAction,
  upsertHalfTermAction,
  readSowHalfTermUnitsAction,
  readTeacherGroupsForSowAction,
} from './server-actions/sow'
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: the errors about missing exports from `server-updates.ts` are gone now; remaining new errors should only be in `src/components/sow/SowHalfTermTable.tsx` (fixed in Task 3) and the two pre-existing baseline errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/lib/server-updates.ts
git commit -m "Remove re-exports of deleted SoW half-term-unit edit actions"
```

---

### Task 3: Strip `SowHalfTermTable` to read-only

**Files:**
- Modify: `src/components/sow/SowHalfTermTable.tsx`

Current full file content:

```tsx
'use client'

import { useState } from 'react'
import {
  addSowHalfTermUnitAction,
  removeSowHalfTermUnitAction,
  assignHalfTermUnitsToGroupsAction,
} from '@/lib/server-updates'
import { toast } from 'sonner'
import type { HalfTerm, SowHalfTermUnit, TeacherGroup, Unit } from '@/types'
import { Button } from '@/components/ui/button'

const HALF_TERM_NAMES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

type Props = {
  groupId: string
  year: number
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
  units: Unit[]
  allGroups: TeacherGroup[]
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

export function SowHalfTermTable({ groupId, year, halfTerms, htUnits, units, allGroups }: Props) {
  const [localHtUnits, setLocalHtUnits] = useState<SowHalfTermUnit[]>(htUnits)
  const [adding, setAdding] = useState<string | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [showAssign, setShowAssign] = useState(false)

  const halfTermMap = new Map(halfTerms.map((ht) => [ht.name, ht]))

  async function handleAdd(halfTermId: string, unitId: string) {
    const { error } = await addSowHalfTermUnitAction(groupId, halfTermId, unitId)
    if (error) { toast.error('Failed to add unit'); return }
    const unit = units.find((u) => u.unit_id === unitId)
    setLocalHtUnits((prev) => [
      ...prev,
      {
        group_id: groupId,
        half_term_id: halfTermId,
        unit_id: unitId,
        unit_name: unit?.title,
        position: prev.filter((u) => u.half_term_id === halfTermId).length,
      },
    ])
    setAdding(null)
  }

  async function handleRemove(halfTermId: string, unitId: string) {
    const { error } = await removeSowHalfTermUnitAction(groupId, halfTermId, unitId)
    if (error) { toast.error('Failed to remove unit'); return }
    setLocalHtUnits((prev) =>
      prev.filter((u) => !(u.half_term_id === halfTermId && u.unit_id === unitId)),
    )
  }

  function toggleGroup(groupId: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      next.has(groupId) ? next.delete(groupId) : next.add(groupId)
      return next
    })
  }

  async function handleAssign() {
    if (selectedGroups.size === 0) { toast.error('Select at least one class'); return }
    setAssigning(true)
    const { error } = await assignHalfTermUnitsToGroupsAction(groupId, [...selectedGroups], year)
    setAssigning(false)
    if (error) { toast.error('Failed to assign'); return }
    toast.success(`Assigned to ${selectedGroups.size} class${selectedGroups.size > 1 ? 'es' : ''}`)
    setShowAssign(false)
    setSelectedGroups(new Set())
  }

  return (
    <div className="mb-8 space-y-3">
      <div className="overflow-x-auto">
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
                    {ht ? (
                      <div className="text-xs font-normal text-[var(--color-text-secondary)]">
                        {formatDateRange(ht.start_date, ht.end_date)}
                      </div>
                    ) : (
                      <div className="text-xs font-normal text-[var(--color-text-tertiary)]">
                        Not configured
                      </div>
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
                  ? localHtUnits
                      .filter((u) => u.half_term_id === ht.id)
                      .sort((a, b) => a.position - b.position)
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
                              aria-label={`Remove ${cu.unit_name ?? cu.unit_id}`}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                      {ht && adding === ht.id ? (
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
                              <option key={u.unit_id} value={u.unit_id}>
                                {u.title}
                              </option>
                            ))}
                        </select>
                      ) : ht ? (
                        <button
                          onClick={() => setAdding(ht.id)}
                          className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-left mt-0.5"
                        >
                          + Add unit
                        </button>
                      ) : null}
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Assign to other classes */}
      {allGroups.length > 0 && (
        <div className="flex items-start gap-2">
          {showAssign ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {allGroups.map((g) => (
                  <button
                    key={g.group_id}
                    onClick={() => toggleGroup(g.group_id)}
                    className={`rounded px-2.5 py-1 text-xs border transition-colors ${
                      selectedGroups.has(g.group_id)
                        ? 'bg-[var(--color-text-primary)] text-[var(--color-background-primary)] border-[var(--color-text-primary)]'
                        : 'bg-[var(--color-background-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'
                    }`}
                  >
                    {g.group_id}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={handleAssign} disabled={assigning || selectedGroups.size === 0}>
                {assigning ? 'Assigning…' : `Assign${selectedGroups.size > 0 ? ` (${selectedGroups.size})` : ''}`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAssign(false); setSelectedGroups(new Set()) }}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowAssign(true)}>
              Assign to…
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 1: Replace the entire file**

Replace it with:

```tsx
import type { HalfTerm, SowHalfTermUnit } from '@/types'

const HALF_TERM_NAMES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const

type Props = {
  halfTerms: HalfTerm[]
  htUnits: SowHalfTermUnit[]
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

export function SowHalfTermTable({ halfTerms, htUnits }: Props) {
  const halfTermMap = new Map(halfTerms.map((ht) => [ht.name, ht]))

  return (
    <div className="mb-8 space-y-3">
      <div className="overflow-x-auto">
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
                    {ht ? (
                      <div className="text-xs font-normal text-[var(--color-text-secondary)]">
                        {formatDateRange(ht.start_date, ht.end_date)}
                      </div>
                    ) : (
                      <div className="text-xs font-normal text-[var(--color-text-tertiary)]">
                        Not configured
                      </div>
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
                  ? htUnits
                      .filter((u) => u.half_term_id === ht.id)
                      .sort((a, b) => a.position - b.position)
                  : []

                return (
                  <td
                    key={name}
                    className="border border-[var(--color-border)] bg-[var(--color-background-primary)] px-3 py-2 align-top"
                  >
                    <div className="flex flex-col gap-1">
                      {cellUnits.length === 0 ? (
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          No lessons scheduled
                        </span>
                      ) : (
                        cellUnits.map((cu) => (
                          <span
                            key={cu.unit_id}
                            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-background-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-xs"
                          >
                            {cu.unit_name ?? cu.unit_id}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

Note: this drops `'use client'` — the component has no state or event handlers left, so it can render as a plain server component (it doesn't use `useState`, `onClick`, or any browser-only API). This is a deliberate simplification, not an oversight.

- [ ] **Step 2: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: new errors will appear at the call site of `<SowHalfTermTable>` in `src/app/sow/[groupId]/sow-client.tsx`, since it still passes the old props (`groupId`, `year`, `units`, `allGroups`) that no longer exist on `Props`. This is EXPECTED — Task 4 fixes it. Beyond that, no new errors beyond the two pre-existing baseline errors.

- [ ] **Step 3: Self-review**

Confirm the file has no remaining references to `sonner`, `Button`, `useState`, or any of the deleted server actions.

- [ ] **Step 4: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add src/components/sow/SowHalfTermTable.tsx
git commit -m "Make SowHalfTermTable a read-only summary component"
```

---

### Task 4: Update callers — `sow-client.tsx` and `page.tsx`

**Files:**
- Modify: `src/app/sow/[groupId]/sow-client.tsx`
- Modify: `src/app/sow/[groupId]/page.tsx`

Current full content of `sow-client.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { SowHalfTermTable } from '@/components/sow/SowHalfTermTable'
import { SowWeekList } from '@/components/sow/SowWeekList'
import type { HalfTerm, SowHalfTermUnit, TeacherGroup, Unit } from '@/types'
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
  allGroups: TeacherGroup[]
  onYearChange: (year: number) => Promise<YearData>
}

export function SowClient({
  groupId,
  groupName,
  availableYears,
  initialYear,
  initialData,
  units,
  allGroups,
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
        groupId={groupId}
        year={year}
        halfTerms={currentData.halfTerms}
        htUnits={currentData.htUnits}
        units={units}
        allGroups={allGroups}
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

`units` is still needed (passed through to `SowWeekList`), but `allGroups`/`TeacherGroup` is no longer used anywhere in this file once `SowHalfTermTable` stops taking it.

- [ ] **Step 1: Update `sow-client.tsx`**

Replace the entire file with:

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

Current full content of `page.tsx`:

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

`groupsResult`/`readTeacherGroupsForSowAction(targetTeacherId)` is still needed for the `group`/`notFound()` lookup — only the `allGroups` derivation and its pass-through to `SowClient` are dead now.

- [ ] **Step 2: Update `page.tsx`**

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
import type { HalfTerm, SowHalfTermUnit, Unit } from '@/types'

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
        onYearChange={onYearChange}
      />
    </main>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit`

Expected: zero new errors — only the two pre-existing unrelated baseline errors in `tests/prototypes/fast-ui.spec.ts` should remain. This confirms the entire chain (Tasks 1-4) compiles cleanly together.

- [ ] **Step 4: Build**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run build`

Expected: build succeeds. **Only run this if no `npm run dev` server is currently active for this project** — check first with `lsof -nP -iTCP:3000 -sTCP:LISTEN`; if something is listening on port 3000, skip this build step entirely (rely on the `tsc --noEmit` check instead) to avoid corrupting the dev server's `.next/` directory.

- [ ] **Step 5: Self-review**

`git diff src/app/sow/[groupId]/sow-client.tsx src/app/sow/[groupId]/page.tsx` — confirm: `TeacherGroup`/`allGroups` removed from both files; `units` still flows through to `SowWeekList`; `groupsResult/readTeacherGroupsForSowAction` call and the `notFound()` check are untouched.

- [ ] **Step 6: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004
git add "src/app/sow/[groupId]/sow-client.tsx" "src/app/sow/[groupId]/page.tsx"
git commit -m "Drop unused allGroups plumbing from SoW detail page"
```

---

### Task 5: Manual end-to-end verification

**No files changed in this task — verification only.**

- [ ] **Step 1: Start the dev server (if not already running)**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npm run dev`

- [ ] **Step 2: Verify the half-term grid reflects actual scheduled lessons**

1. Sign in as a teacher with at least one class set up.
2. In the Teacher Planner (`/teacher-planner`), assign at least two lessons from two different units to two different weeks that fall within the same half-term, for one of your classes.
3. Navigate to `/sow/<that-group-id>`.
4. Confirm the half-term grid cell for that half-term shows both units, with the one scheduled in the earlier week listed first.
5. Confirm there is no "+ Add unit" control and no "Assign to…" control anywhere on the page.
6. Confirm a half-term with no scheduled lessons for this group shows "No lessons scheduled" (or an empty cell, per the implemented copy) rather than any leftover manually-added units from before this change.

- [ ] **Step 3: Verify the week-by-week table is unaffected**

1. On the same `/sow/<group-id>` page, confirm the week-by-week table below the grid still shows the same lessons it did before this change (it derives from `readGroupSowLessonsAction`, untouched by this work).

- [ ] **Step 4: Verify across academic years and other classes**

1. Switch the year selector at the top of the page — confirm the half-term grid updates to reflect that year's scheduled lessons (or shows empty cells for a year with nothing scheduled).
2. Repeat Step 2 for a second class — confirm the grid is correctly scoped per-group (one class's scheduled units don't leak into another's grid).
