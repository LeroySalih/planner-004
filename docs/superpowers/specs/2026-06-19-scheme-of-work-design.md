# Scheme of Work (SoW) — Design Spec
**Date:** 2026-06-19

## Overview

Add a Scheme of Work feature to DINO. A Scheme of Work (SoW) is a per-class, per-academic-year view of which units and lessons are planned across the year, broken down by half term and week. It shares the same lesson planning data as the existing `/teacher-planner`, giving teachers two complementary surfaces: one for week-level curriculum mapping (SoW) and one for day/period timetabling (teacher-planner).

---

## Data Model

### New table: `half_terms`

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
year        integer NOT NULL          -- academic year start, e.g. 2026
name        text NOT NULL             -- 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6'
start_date  date NOT NULL
end_date    date NOT NULL
UNIQUE (year, name)
```

Six rows per academic year. Configured in the admin pages. The academic year runs from H1 start to H6 end.

### New table: `sow_lesson_plan`

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
group_id        text NOT NULL REFERENCES groups(group_id)
lesson_id       text NOT NULL REFERENCES lessons(lesson_id)
unit_id         text NOT NULL            -- denormalised for fast half-term grouping
week_start_date date NOT NULL
created_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (group_id, lesson_id, week_start_date)
```

The shared backbone between SoW and teacher-planner. Contains "this lesson is planned for this class this week" with no day/period constraint.

### New table: `sow_half_term_units`

```sql
group_id      text NOT NULL REFERENCES groups(group_id)
half_term_id  uuid NOT NULL REFERENCES half_terms(id)
unit_id       text NOT NULL
position      integer NOT NULL DEFAULT 0
PRIMARY KEY (group_id, half_term_id, unit_id)
```

Records which units appear in each half term for a class. Independent of lesson-level planning — this is the curriculum map. `position` controls display order within a half-term column.

### Dual-write rule

`upsertPlannerAssignmentAction` and `deletePlannerAssignmentAction` must also upsert/delete the corresponding `sow_lesson_plan` row. This keeps both planning surfaces in sync without a separate sync job.

SoW add/remove lesson actions write to `sow_lesson_plan` only — teachers use the teacher-planner to place those lessons into specific timetable slots.

---

## Routes

| Route | Description |
|---|---|
| `/sow` | Landing page — class cards for the current teacher |
| `/sow/[groupId]` | SoW for a specific class |

Add "SOW" to the side navigation menu pointing to `/sow`.

---

## `/sow` — Landing Page

- Server component, requires teacher auth.
- Fetches only groups belonging to the current teacher.
- Renders a grid of class cards. Each card shows: class name, current academic year, and a brief summary (e.g. "H1 – H3 planned").
- Clicking a card navigates to `/sow/[groupId]`.

---

## `/sow/[groupId]` — Scheme of Work Page

### Header bar

- Left: class name.
- Right: academic year selector (e.g. "2025–26", "2026–27"), defaulting to the current academic year.

### Half-term overview table

A 2-row × 6-column table. Column = half term (H1–H6).

**Row 1 — labels:** Half-term name and date range, e.g. "H1 · 04 Sep – 18 Oct". Dates derived from the configured `half_terms` rows for the selected year.

**Row 2 — units:** Unit chips from `sow_half_term_units`. Each chip shows the unit name with an ✕ to remove. An "Add unit" control (dropdown of available units) is shown at the end of each cell. A half-term cell can hold multiple units, ordered by `position`.

### Week-by-week breakdown

A vertical list of week rows covering H1 start date through H6 end date. Weeks are 7-day spans starting Sunday (project convention).

Each week row contains:
- Half-term badge (coloured label: H1–H6) on the left.
- Week label: "Week N · DD Mon – DD Mon".
- Lesson list: lesson titles from `sow_lesson_plan` for this group + week, shown as a bullet list. Each has an ✕ remove button.
- "Add lesson" button: opens a two-step picker (select unit → select lesson), same UX as the SidePanel in teacher-planner. Writes to `sow_lesson_plan` only.

Weeks that fall between half terms (holidays) are shown collapsed and greyed: "Holiday · no lessons".

---

## Admin: Half Term Configuration

Add a section to the admin pages for managing `half_terms`. Per academic year (integer), teachers/admins can:
- View the six half terms (H1–H6) with their start and end dates.
- Edit the dates for each half term.
- Add a new year's set of half terms (copy from previous year as a starting point).

---

## Server Actions

| Action | Table(s) written |
|---|---|
| `readHalfTermsAction(year)` | `half_terms` (read) |
| `upsertHalfTermAction(year, name, startDate, endDate)` | `half_terms` |
| `readSowHalfTermUnitsAction(groupId, year)` | `sow_half_term_units` + `half_terms` (read) |
| `addSowHalfTermUnitAction(groupId, halfTermId, unitId)` | `sow_half_term_units` |
| `removeSowHalfTermUnitAction(groupId, halfTermId, unitId)` | `sow_half_term_units` |
| `readSowLessonPlanAction(groupId, year)` | `sow_lesson_plan` (read) |
| `addSowLessonAction(groupId, lessonId, unitId, weekStartDate)` | `sow_lesson_plan` |
| `removeSowLessonAction(groupId, lessonId, weekStartDate)` | `sow_lesson_plan` |
| *(modified)* `upsertPlannerAssignmentAction` | `planner_assignments` + `sow_lesson_plan` |
| *(modified)* `deletePlannerAssignmentAction` | `planner_assignments` + `sow_lesson_plan` |

All actions follow the standard `{ data, error }` return shape with Zod validation and `requireTeacherProfile()` guards.

---

## File Structure

```
src/
  app/
    sow/
      page.tsx                          -- landing page (server)
      [groupId]/
        page.tsx                        -- SoW page (server)
        sow-client.tsx                  -- client component
  components/
    sow/
      SowHalfTermTable.tsx              -- 2×6 overview table
      SowWeekList.tsx                   -- week-by-week section
      SowWeekRow.tsx                    -- single week row
      SowLessonPicker.tsx               -- unit → lesson two-step picker
  lib/
    server-actions/
      sow.ts                            -- all new SoW server actions
  migrations/
    YYYYMMDD_sow_tables.sql             -- half_terms, sow_lesson_plan, sow_half_term_units
```

---

## Constraints & Notes

- Dates displayed in DD-MM-YYYY format per project convention.
- Weeks start Sunday per project convention.
- Academic year selector uses the convention of the year the autumn term starts (e.g. 2026 = 2026–27).
- The SoW is read-only for teachers viewing another teacher's planner; the SoW itself is always the current teacher's own classes.
- No unit test infrastructure exists; correctness is verified via Playwright E2E tests if added.
