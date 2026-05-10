# Unit Report PDF — Design Spec

**Date:** 2026-05-11  
**Status:** Approved

---

## Overview

Add a "Generate Report" button to the Unit detail page (`/units/[unitId]`) that produces a downloadable PDF summarising the unit. The PDF follows the Cornell Notes visual style used across the site (dark navy header, two-column tables, `mr-salih.org` footer).

The button is visible to **teachers only**. Pupils do not see it.

---

## PDF Content Structure

### Page 1 — Unit Overview

1. **Header** — dark navy bar, unit title centred, circular avatar top-right, "Unit Report" subtitle
2. **Info bar** — `Subject: <subject> · Year <year>` on left, `mr-salih.org` on right
3. **Unit Description** section — navy section header, then a text block with the unit's description (or a "No description provided" placeholder if null)
4. **Learning Objectives & Success Criteria** section — navy section header, then a two-column table:
   - Rows grouped by **Assessment Objective** (AO code + title as a spanning sub-header row)
   - Within each AO group, one row per Learning Objective
   - Left column: LO reference (`spec_ref` if set, else `order_index`) + LO title
   - Right column: success criteria listed in order, each prefixed with a level badge (`L3`, `L5`, `L7`, etc.)

### Page 2+ — Lessons

5. **Lessons header** — repeating page header + info bar + navy section header "Lessons"
6. **One block per lesson** (in `order_by` order):
   - Dark navy lesson title bar showing lesson number and title
   - Two-column table: left = LO reference + title, right = SC items with level badges
     - A lesson may have multiple LOs; each gets its own table row
   - If the lesson has file-download activities **or** lesson links: a full-width footer row inside the table with a "📎 Downloadable Files" label and one line per file/link

---

## Visual Style

Matches the existing Cornell Notes PDFs:

| Element | Style |
|---|---|
| Primary colour | `#1a2744` (dark navy) |
| Section headers | Navy background, white bold text, full width |
| Lesson title bars | Slightly lighter navy `#2d3f6b`, white text |
| Table borders | `#cccccc` 1px |
| Left column | 30% width, navy text, bold LO ref |
| Right column | 70% width |
| Level badges | Navy pill, white text, small font |
| Footer | `Page N | mr-salih.org`, centred, grey |
| Page size | A4 |
| Avatar | Circular image, top-right of header (same asset used by lesson plan PDF) |

---

## Architecture

Follows the identical pattern as the existing lesson-plan PDF:

```
src/
├── app/api/unit-report/[unitId]/route.tsx        # NEW — GET handler
├── components/pdf/
│   ├── unit-report-document.tsx                  # NEW — @react-pdf/renderer component
│   └── unit-report-download-button.tsx           # NEW — client <a> button
└── lib/server-actions/
    └── lessons.ts                                # MODIFY — add readLessonFileActivitiesByUnitAction
```

`src/components/units/unit-detail-view.tsx` — MODIFY: add `<UnitReportDownloadButton unitId={unit.unit_id} />` in the page header/toolbar area.

---

## API Route — `GET /api/unit-report/[unitId]`

1. Call `requireRole('teacher')` — return 403 if not a teacher
2. Fetch in parallel:
   - `readUnitAction(unitId)` → unit
   - `readLearningObjectivesByUnitAction(unitId)` → LOs with SCs
   - `readLessonsByUnitAction(unitId)` → lessons with `lesson_links` and `lesson_success_criteria`
   - `readLessonFileActivitiesByUnitAction(unitId)` → file-download activities keyed by `lesson_id`
3. Build props object and pass to `UnitReportDocument`
4. `renderToBuffer(<UnitReportDocument {...props} />)`
5. Return `Response` with headers:
   - `Content-Type: application/pdf`
   - `Content-Disposition: attachment; filename="<sanitised-unit-title>-report.pdf"`
   - `Cache-Control: no-store`

---

## New Server Action — `readLessonFileActivitiesByUnitAction`

Location: `src/lib/server-actions/lessons.ts`

Query: select activities where `unit_id = $1` and `activity_type = 'file-download'`, joining through `lesson_activities → lessons`. Returns a `Record<string, Activity[]>` keyed by `lesson_id`.

---

## Download Button

`UnitReportDownloadButton` is a simple client component:

```tsx
<a href={`/api/unit-report/${unitId}`} download>
  <Button variant="outline">Generate Report</Button>
</a>
```

No loading state needed — the browser handles the download natively. Matches the pattern in `lesson-plan-download-button.tsx`.

---

## Data Grouping Logic (in PDF component)

**LOs grouped by AO:**
```
group LOs by assessment_objective_id
sort groups by assessment_objective_order_index
within each group, sort LOs by order_index
sort SCs within each LO by order_index
```

**Lessons:**
```
sort by order_by ASC, then title ASC
for each lesson:
  collect lesson_objectives (sorted by order_by)
  collect file-download activities + lesson_links → deduplicated by name/url
```

---

## Authorization

- Route: `requireRole('teacher')` at the top of the handler
- Button: rendered conditionally in `unit-detail-view.tsx` only when the current profile has the teacher role (the page already has access to the profile via `requireAuthenticatedProfile`)

---

## Out of Scope

- No assignment data in the PDF
- No pupil progress or scores
- No unit-level files (only lesson-level files and links)
- No print-from-browser option (download only)
