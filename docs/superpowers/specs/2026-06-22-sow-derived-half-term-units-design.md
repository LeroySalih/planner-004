# SoW Half-Term Grid Derived From Teacher-Planner Assignments — Design

## Problem

The SoW half-term grid (`SowHalfTermTable`, rendered on `/sow/[groupId]`) shows which units are taught in each half-term, but its data comes from `sow_half_term_units` — a table populated only by manually clicking "+ Add unit" on the grid itself. This is a second, independent source of truth from the actual lesson assignments made in the Teacher Planner (`planner_assignments`), and the two can disagree: a unit can show in the grid with zero lessons actually scheduled, or a unit can have lessons scheduled with nothing showing in the grid. The grid should instead be a read-only summary of what's actually been scheduled.

## Goals

- The half-term grid shows, for each half-term, the distinct units that have at least one lesson scheduled (via the Teacher Planner) for this group within that half-term's date range.
- The grid is read-only — no "+ Add unit", no remove control, no "Assign to…" (copy to other classes) control.
- Units within a half-term cell are ordered by the earliest scheduled lesson date for that unit within that half-term.

## Non-goals

- No database migration. `sow_half_term_units` stays in the schema, untouched, simply unused going forward (confirmed acceptable — no other reports/pages depend on it, confirmed via codebase search).
- No change to `SowWeekList` or `readGroupSowLessonsAction` — the week-by-week table below the grid already derives from `planner_assignments` correctly and is out of scope.
- No change to how lessons get assigned to units, or how lessons get scheduled via the Teacher Planner — unchanged.

## Design

### 1. `readSowHalfTermUnitsAction` — same name/signature, new query

**File:** `src/lib/server-actions/sow.ts:81-101`

Keep the function's name, signature (`(groupId: string, year: number)`), and return shape (`z.infer<typeof SowHalfTermUnitsResult>`, i.e. `SowHalfTermUnit[]` per the existing schema: `{group_id, half_term_id, unit_id, unit_name?, position}`) — only the query body changes, so no caller needs to change how it invokes this action.

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

(`group_id` isn't selected by the SQL — it's the same for every row, so it's injected in the JS mapping step rather than repeated in every SQL row, matching the existing `SowHalfTermUnitSchema` shape exactly.)

### 2. Delete the manual-edit actions

**File:** `src/lib/server-actions/sow.ts`

Remove entirely: `addSowHalfTermUnitAction`, `removeSowHalfTermUnitAction`, `assignHalfTermUnitsToGroupsAction`. Remove their re-exports from `src/lib/server-updates.ts`.

### 3. `SowHalfTermTable` becomes read-only

**File:** `src/components/sow/SowHalfTermTable.tsx`

New props: `{ halfTerms: HalfTerm[]; htUnits: SowHalfTermUnit[] }` (drop `groupId`, `year`, `units`, `allGroups` — none of these are needed once there's no mutation).

Remove: the `'use client'`/`useState` for `localHtUnits`/`adding`/`selectedGroups`/`assigning`/`showAssign` (the component no longer needs local state or to be a client component at all, since it has no interactivity left — it can become a plain server-renderable function, though it may stay as a client component if simpler given its sibling import patterns; implementer's call, functionally equivalent either way), `handleAdd`, `handleRemove`, `toggleGroup`, `handleAssign`, the "+ Add unit" `<select>`/button, the per-unit remove `✕` button, and the entire "Assign to other classes" block (lines 181-214 in the current file).

Keep: the table/grid structure, header date-range formatting, and the unit-badge rendering (just without the `✕` button inside each badge) — render `htUnits` directly instead of a `localHtUnits` copy, since there's nothing to mutate locally anymore.

### 4. Update callers

**Files:** `src/app/sow/[groupId]/sow-client.tsx`, `src/app/sow/[groupId]/page.tsx`

Update the `<SowHalfTermTable>` call site to pass only `halfTerms`/`htUnits`. Check whether `units` and `allGroups` (currently threaded down to `SowClient`/`SowHalfTermTable`) are still needed elsewhere on the page (e.g. `units` is also used by `SowWeekList`, `allGroups` may have been solely for the old "Assign to…" feature) — remove `allGroups`/`TeacherGroup`-related plumbing from `page.tsx` and `sow-client.tsx` if, after this change, nothing else on the page uses it (implementer confirms by checking remaining usages before removing).

## Testing

Same situation as other recent features in this codebase: no unit/integration test runner exists for server actions. Verification is manual:
- Schedule lessons from two different units in the same half-term for a group via the Teacher Planner; confirm the SoW half-term grid for that group shows both units, ordered by which one's first lesson was scheduled earliest within that half-term.
- Confirm a half-term with no scheduled lessons shows an empty cell (no leftover manually-added units from before this change, since the grid no longer reads `sow_half_term_units` at all).
- Confirm there is no "+ Add unit" or "Assign to…" control anywhere on the page.
- Confirm the week-by-week table below the grid is unaffected (still shows the same lessons as before this change).

## Files touched

- `src/lib/server-actions/sow.ts` — rewrite `readSowHalfTermUnitsAction`'s query; delete `addSowHalfTermUnitAction`, `removeSowHalfTermUnitAction`, `assignHalfTermUnitsToGroupsAction`
- `src/lib/server-updates.ts` — remove re-exports of the three deleted actions
- `src/components/sow/SowHalfTermTable.tsx` — strip to read-only rendering, reduced props
- `src/app/sow/[groupId]/sow-client.tsx`, `src/app/sow/[groupId]/page.tsx` — update `SowHalfTermTable` call site; remove now-unused `allGroups` plumbing if nothing else needs it
