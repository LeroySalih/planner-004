# Admin Teacher Dropdown on SoW Page — Design

## Problem

The SoW (Scheme of Work) pages — `/sow` (landing, lists a teacher's classes) and `/sow/[groupId]` (detail, half-term unit planning for one class) — are hard-scoped to the logged-in teacher: every read action implicitly uses `profile.userId`. Admins need to view and fully edit any teacher's SoW, the same way the earlier Teacher Planner change let admins edit any teacher's weekly planner.

## Goals

- On `/sow`, admins see a dropdown of teacher names. Selecting a teacher shows that teacher's classes instead of the admin's own.
- Clicking into a class from the dropdown-selected view opens that teacher's SoW detail page (`/sow/[groupId]`) with full edit access — same UI, same capabilities the owning teacher has.
- Non-admins see no dropdown and no behavior change — `/sow` and `/sow/[groupId]` work exactly as today.
- Admins get full edit access to another teacher's SoW (not view-only) — per design decision, no `readOnly` gating needed anywhere in this feature.

## Non-goals

- No new ownership/authorization checks on `addSowHalfTermUnitAction`, `removeSowHalfTermUnitAction`, or `assignHalfTermUnitsToGroupsAction`. These currently have no group-ownership check at all (any signed-in teacher can already call them for any `groupId`) — a pre-existing gap, unrelated to this feature, left untouched.
- No changes to `readGroupSowLessonsAction` (already takes `groupId` directly, not teacher-scoped, and is fine as-is for both the admin and non-admin case).
- No visible "editing as admin" banner — consistent with the earlier Teacher Planner feature's decision to unlock silently.

## Design

### 1. `readTeacherGroupsForSowAction` gains an optional target teacher

**File:** `src/lib/server-actions/sow.ts:179-194`

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

This mirrors `readTimetableSlotGroupsAction`'s existing optional-teacherId shape, but adds the `requireTeacherOrAdminAccess` gate (which `readTimetableSlotGroupsAction` doesn't have today — out of scope to retrofit there; this action is the one actually used for SoW access control going forward).

### 2. `/sow` landing page — split into server page + client component

**Files:**
- Modify: `src/app/sow/page.tsx`
- Create: `src/components/sow/SowLandingClient.tsx`

The page becomes:

```tsx
import { requireTeacherProfile, hasRole } from '@/lib/auth'
import { readTeacherGroupsForSowAction } from '@/lib/server-updates'
import { readTeachersAction } from '@/lib/server-updates'
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

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-medium text-[var(--color-text-primary)] mb-6">
        Schemes of Work — {academicYearLabel(year)}
      </h1>
      <SowLandingClient
        initialGroups={groupsResult.data ?? []}
        teachers={teachersResult.data ?? []}
        currentTeacherId={profile.userId}
        isAdmin={isAdmin}
      />
    </main>
  )
}
```

`SowLandingClient` holds `selectedTeacherId` state (defaulting to `currentTeacherId`), renders the teacher `<select>` only when `isAdmin` (same dropdown markup/pattern as `TeacherPlannerClient`'s), and on change calls `readTeacherGroupsForSowAction(selectedTeacherId)` client-side to refresh the groups grid. Each class link becomes:

```tsx
href={selectedTeacherId === currentTeacherId ? `/sow/${g.group_id}` : `/sow/${g.group_id}?teacherId=${selectedTeacherId}`}
```

so the common case (own classes) keeps a clean URL, and the admin-viewing-another-teacher case carries the choice forward via query param.

The "no classes found" empty state and grid layout are otherwise unchanged from today's markup — just moved into the client component and driven by its own `groups` state instead of a server-fetched constant.

### 3. `/sow/[groupId]` detail page — read and honor `?teacherId=`

**File:** `src/app/sow/[groupId]/page.tsx`

```tsx
import { requireTeacherProfile, requireTeacherOrAdminAccess } from '@/lib/auth'
// ...existing imports...

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

`SowClient` needs no changes — confirmed by reading `sow-client.tsx` in full: it never builds navigation links itself (`allGroups` only feeds the "copy half-term units to other classes" selector inside `SowHalfTermTable`, not links), so it has no need for a `teacherId` prop.

A non-admin teacher passing a `?teacherId=` for someone else gets rejected by `requireTeacherOrAdminAccess` (thrown error surfaces as the page's error boundary — acceptable, since this is direct URL tampering, not a normal UI path).

## Testing

Same situation as the Teacher Planner feature: no unit/integration test infrastructure exists for server actions in this repo. Verification is manual:
- As admin: visit `/sow`, confirm the teacher dropdown appears, selecting another teacher swaps the class grid, clicking a class opens that teacher's SoW detail page with full edit controls (add/remove unit, assign half-terms), and the URL carries `?teacherId=`.
- As non-admin: confirm `/sow` shows no dropdown and behaves exactly as before; confirm directly visiting `/sow/[groupId]?teacherId=<someone-else>` is rejected.
- As admin viewing own classes (dropdown defaulted to self): confirm URLs stay clean (no `?teacherId=` param) and behavior is unchanged from before this feature.

## Files touched

- `src/lib/server-actions/sow.ts` — `readTeacherGroupsForSowAction` gains optional `targetTeacherId`
- `src/app/sow/page.tsx` — compute `isAdmin`, fetch teachers conditionally, delegate to new client component
- `src/components/sow/SowLandingClient.tsx` — new, holds dropdown state and class grid
- `src/app/sow/[groupId]/page.tsx` — read `?teacherId=` searchParam, authorize via `requireTeacherOrAdminAccess`, pass `targetTeacherId` through
