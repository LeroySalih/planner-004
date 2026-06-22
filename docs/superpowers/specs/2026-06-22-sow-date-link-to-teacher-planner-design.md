# SoW Week Date Links to Teacher Planner — Design

## Problem

On `/sow/[groupId]`, each row in the week-by-week table shows a date label ("Week N · DD Mon – DD Mon") but it's plain text. Clicking it should take the teacher straight to that week on `/teacher-planner`, since that's where lessons for that week are actually scheduled/edited.

## Goals

- Every week label in the SoW week list (`SowWeekRow`) becomes a link to `/teacher-planner`, landing on that specific week — including holiday/non-half-term weeks (decided: link everything, for consistency and simplicity, rather than special-casing holiday rows).
- If the SoW page is being viewed for a specific teacher (own page, or an admin viewing another teacher's via `?teacherId=`), the link preselects that same teacher on the Teacher Planner.
- The whole label text is the clickable link (not just the date range).

## Non-goals

- No continuous URL-state syncing on `/teacher-planner` — prev/next week and the teacher dropdown continue to be pure client state with no URL updates, exactly as today. Only the initial week/teacher on page load is seedable via URL.
- No "jump to a specific class/slot" — Teacher Planner has no such concept; week + teacher is the deepest link granularity available.
- No new authorization logic. Viewing (not editing) another teacher's planner via the dropdown was already unrestricted to any signed-in teacher before this change (only writes are gated by `requireTeacherOrAdminAccess`/`isAdmin`), so accepting a `?teacherId=` param to preselect a teacher needs no new gate.

## Design

### 1. `/teacher-planner` gains one-time URL seeding

**File:** `src/app/teacher-planner/page.tsx`

Add `searchParams: Promise<{ week?: string; teacherId?: string }>` to the page's props, read it, and pass `initialWeek`/`initialSelectedTeacherId` as new optional props into `<TeacherPlannerClient>`.

**File:** `src/components/teacher-planner/TeacherPlannerClient.tsx`

Add optional props `initialWeek?: string` and `initialSelectedTeacherId?: string`. Seed existing state from them instead of always defaulting:
```ts
const [currentWeek, setCurrentWeek] = useState<string>(initialWeek ?? getTodaySunday)
const [selectedTeacherId, setSelectedTeacherId] = useState<string>(initialSelectedTeacherId ?? currentTeacherId)
```
Everything else (prev/next week handlers, the teacher `<select>` dropdown, all write actions) is unchanged — this only affects the starting values.

### 2. Thread the week ISO date and teacher id down to the link

**File:** `src/components/sow/SowWeekList.tsx`

The week's ISO date string is already computed locally as `iso` (line 91, `const iso = toIsoDate(weekStart)`) but never passed down — only the pre-formatted `weekLabel` string is. Add `weekStartIso={iso}` to the `<SowWeekRow>` call. Also accept a new `teacherId?: string` prop on `SowWeekList` itself and pass it straight through to `<SowWeekRow teacherId={teacherId} ... />`.

**File:** `src/app/sow/[groupId]/page.tsx` → `src/app/sow/[groupId]/sow-client.tsx` → `SowWeekList`

The page already resolves `targetTeacherId` (from `?teacherId=` or the caller's own id) for its own authorization check. Thread it through as a new `teacherId` prop on `SowClient` and pass it down to `<SowWeekList teacherId={teacherId} ... />`.

### 3. `SowWeekRow` renders the label as a link

**File:** `src/components/sow/SowWeekRow.tsx`

Add `weekStartIso: string` and `teacherId?: string` to `Props`. Replace the plain `<span>{weekLabel}</span>` (appears in two render branches — the holiday-row branch and the no-lessons/has-lessons branch, which share the same `<div className="flex items-center gap-1.5">{badge}<span>{weekLabel}</span></div>` markup) with:
```tsx
<Link
  href={`/teacher-planner?week=${weekStartIso}${teacherId ? `&teacherId=${teacherId}` : ''}`}
  className="hover:underline"
>
  {weekLabel}
</Link>
```
`next/link`'s `Link` is already imported and used in this file for the unit/lesson/score cells, so this follows the existing pattern. All three branches (holiday, no-lessons, has-lessons) get the link — decided: no special-casing for holiday weeks.

## Testing

Same situation as every other recent feature in this codebase: no unit/integration test runner for server actions/pages exists. Verification is manual:
- On `/sow/[groupId]`, click a week label with lessons scheduled — confirm it navigates to `/teacher-planner?week=<that-week's-iso-date>` and the planner grid shows that exact week.
- Click a week label with no lessons (empty week within a half-term) and a holiday week label — confirm both navigate correctly too.
- As an admin viewing another teacher's SoW via the dropdown (`?teacherId=` on the SoW page), click a week label — confirm `/teacher-planner` opens with that teacher preselected in its dropdown, not yourself.
- As a regular teacher viewing your own SoW, click a week label — confirm `/teacher-planner` opens with yourself selected (i.e. the `?teacherId=` param, if present, matches your own id and changes nothing visible).
- Confirm normal Teacher Planner navigation (prev/next week, switching teacher in the dropdown) still works exactly as before, with no URL changes during that in-page navigation.

## Files touched

- `src/app/teacher-planner/page.tsx` — read `?week=`/`?teacherId=`, pass as initial props
- `src/components/teacher-planner/TeacherPlannerClient.tsx` — accept and use `initialWeek`/`initialSelectedTeacherId` for initial state
- `src/components/sow/SowWeekList.tsx` — accept `teacherId` prop, pass `weekStartIso`/`teacherId` to `SowWeekRow`
- `src/components/sow/SowWeekRow.tsx` — accept `weekStartIso`/`teacherId`, wrap week label in a `Link`
- `src/app/sow/[groupId]/sow-client.tsx` — accept/thread `teacherId` prop to `SowWeekList`
- `src/app/sow/[groupId]/page.tsx` — pass already-resolved `targetTeacherId` to `SowClient` as `teacherId`
