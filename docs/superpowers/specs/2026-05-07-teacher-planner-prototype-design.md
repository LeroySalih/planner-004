# Teacher Planner Prototype — Design Spec

**Date:** 2026-05-07
**Route:** `/tests/teacher-planner`
**Status:** Approved for implementation

---

## Overview

A weekly teacher planner page built as a test/prototype in the planner-004 Next.js app. The UI is based on the design developed in `planning-ui/files/prototype.html` and its accompanying `spec.md`. It shows a fixed weekly grid of timetable slots, each editable inline, with a slide-in side panel for deeper detail.

Key constraints for this prototype:
- **Live data** — units, lessons, and groups fetched from the real DB
- **Hardcoded timetable** — slot-to-class mapping defined in a TypeScript config file, extracted from the teacher's actual timetable screenshot
- **In-memory state** — no DB persistence; state resets on refresh
- **Full side panel** — all sections implemented except file attachments (not in DB yet)
- **Worktree** — developed in an isolated git worktree

---

## File Structure

```
src/
  app/
    tests/
      teacher-planner/
        page.tsx                  # server component — fetches groups + units
  components/
    teacher-planner/
      TeacherPlannerClient.tsx    # "use client" — owns all state
      PlannerGrid.tsx             # grid shell (rows, break rows, day headers)
      PlannerCell.tsx             # individual timetable cell
      SidePanel.tsx               # slide-in detail panel
      WeekNotes.tsx               # textarea below grid
      timetable-config.ts         # hardcoded TimetableSlot[]
      types.ts                    # shared TypeScript types for this feature
```

---

## Data Layer

### Server (page.tsx)

`page.tsx` is a server component that runs two fetches in parallel at load time:

```ts
const [groupsResult, unitsResult] = await Promise.all([
  readGroupsAction(),
  readUnitsAction(),
])
```

Both results are passed as props to `<TeacherPlannerClient>`. If either fetch errors, the page renders an error state.

### Client (lazy lesson loading)

When the user selects a unit in a cell's unit picker, `TeacherPlannerClient` calls `readLessonsByUnitAction(unitId)` from the client. Results are stored in a `Map<unitId, Lesson[]>` in component state. Subsequent selections of the same unit use the cached result without re-fetching.

### Group matching

The timetable config references class codes (e.g. `"8c/Dt1"`). Groups fetched from the DB are matched by `group.name`. No match is not an error — the slot renders without a pupil count.

---

## Timetable Config

File: `src/components/teacher-planner/timetable-config.ts`

```ts
type TimetableSlot = {
  day: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  period: number          // matches a period index in PERIOD_LAYOUT
  classCode: string       // matches group.name in DB
  subject: string         // display string, e.g. "Design tech"
  room: string            // e.g. "FR87"
  startTime?: string      // e.g. "08:25" — display only
  endTime?: string        // e.g. "09:25" — display only
}

type PeriodRow =
  | { type: 'lesson'; period: number; label: string }  // e.g. { type: 'lesson', period: 1, label: 'L1' }
  | { type: 'break'; label: string }                    // e.g. { type: 'break', label: 'Break' }

export const PERIOD_LAYOUT: PeriodRow[] = [ /* defines the rows in order, including break and lunch positions */ ]
export const TIMETABLE_SLOTS: TimetableSlot[] = [ /* extracted from teacher's timetable screenshot */ ]
```

Both constants are populated from the teacher's actual timetable screenshot during implementation. Both DT slots (e.g. `8c/Dt1`, `9a/Dt1`) and non-DT slots (e.g. `9b/Re1`, `9b/pshe`) are included — the full teacher timetable is shown.

`PlannerGrid` iterates `PERIOD_LAYOUT` to render rows in order: lesson rows get 5 cells (one per day), break/lunch rows span all 5 day columns with a centred label. Empty day-period combinations (no matching slot in `TIMETABLE_SLOTS`) render a blank cell.

---

## State Shape

All mutable state lives in `TeacherPlannerClient`:

```ts
type CellState = {
  unitId: string | null
  lessonId: string | null
  feedbackVisible: boolean
  issueFlag: boolean
  issueNote: string
  lessonNotes: string
}

type PlannerState = Map<string, CellState>   // key: `${day}-${period}`

// Component state:
const [plannerState, setPlannerState] = useState<PlannerState>(new Map())
const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
const [weekNotes, setWeekNotes] = useState('')
const [lessonCache, setLessonCache] = useState<Map<string, Lesson[]>>(new Map())
```

Slot key format: `"sunday-1"`, `"monday-3"`, etc.

---

## Components

### `page.tsx`
Server component. Awaits groups and units in parallel. On error, renders a simple error message. On success, renders `<TeacherPlannerClient>` with the fetched data as props.

### `TeacherPlannerClient`
Root client component. Owns all state. Provides handlers (`onUnitSelect`, `onLessonSelect`, `onCellClick`, `onIssueToggle`, etc.) passed down as props. Renders `<PlannerGrid>`, `<SidePanel>`, and `<WeekNotes>`.

### `PlannerGrid`
Renders the grid using CSS Grid (`grid-template-columns: 70px repeat(5, 1fr)`, `gap: 4px`). Iterates over the 6 periods and inserts Break/Lunch rows at the correct positions. Maps each period × day combination to a `<PlannerCell>` or an empty cell if no timetable slot exists for that combination.

### `PlannerCell`
Receives: slot config, cell state, selected flag, units list, cached lessons for current unit, and event handlers.

Internal layout (top to bottom):
1. Header row — class code (font-weight 500) + subject (muted, right-aligned)
2. Unit picker — plain text + subtle chevron; native `<select>` overlaid at opacity 0 for keyboard support
3. Lesson picker — same shape; disabled until unit selected
4. Hairline divider
5. Icon row — check (✓), percent (%), play (▶)
   - Check: stateful, toggles `feedbackVisible`; teal when on
   - Percent + Play: rendered as `<a>` tags; disabled (opacity 0.2, pointer-events none) when no URL

Cell visual states:
- **Default** — white background, 0.5px border
- **Active** (side panel open) — 1.5px info-blue border
- **Issue** — red-50 background, red-200 border, all text shifts to red ramp

Icon and picker clicks stop propagation so they don't open the side panel.

### `SidePanel`
320px, fixed to the right of the grid container, full grid height. Semi-transparent overlay behind it closes the panel on click.

Sections (top to bottom):
1. **Header** — `Class · Subject` heading, `Day · Lesson N` subtitle, × close button
2. **Details** — key/value list: Unit, Lesson, Room, Pupils; hairline separators; read-only
3. **Previous lesson card** — for this prototype, shows a static placeholder ("No previous lesson recorded") since there is no `LessonInstance` persistence. Renders the amber missing-submissions strip only if a real previous lesson record exists; omitted in the in-memory prototype.
4. **Issue** — label + toggle switch; when on, reveals a textarea for the issue note. Toggling off clears the note.
5. **Objectives** — paragraph text from the selected lesson's objectives field; placeholder text when no lesson selected
6. **Lesson notes** — textarea, placeholder "Differentiation, starters, exit tickets…"; bound to `lessonNotes` in cell state

Files section is **omitted** — no file attachment data in DB yet.

### `WeekNotes`
Simple labelled textarea below the grid. Bound to `weekNotes` state. Min-height 60px, resizable vertically. Placeholder: "Reminders for the week — assemblies, observations, deadlines…"

---

## Visual Design

Follows the `prototype.html` token system, mapped to the app's existing Tailwind + CSS variable setup:

| Token | Value |
|---|---|
| Cell background | white |
| Grid background | subtle tint (`bg-secondary`) |
| Cell border radius | 8px |
| Panel border radius | 12px |
| Font weights | 400 regular, 500 medium only |
| Issue background | `#FCEBEB` (red-50) |
| Issue border | `#F09595` (red-200) |
| Feedback-on colour | `#1D9E75` (teal-600) |
| Missing-submissions strip | `#FAEEDA` bg / `#633806` text |

Dark mode is supported via the app's existing `next-themes` setup.

---

## Out of Scope for This Prototype

- DB persistence of any planner data
- Week navigation (prev/next week)
- File attachments on lessons
- Slide deck and grades URL configuration
- Mobile layout
- Multi-user / role-based access
- Real "previous lesson" records (LessonInstance table does not exist yet)

---

## Development Notes

- Implement in a git worktree (not on main) — this is a significant new feature area
- The worktree name should be `teacher-planner-prototype`
- Follow existing patterns: server actions for all DB access, `cn()` for class merging, `sonner` for any toasts
- No new DB migrations required for this prototype
