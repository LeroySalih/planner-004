# Reports Redesign – Implementation Plan

## 1. Gap Analysis
- Landing page (`src/app/reports/page.tsx`) already lists pupils with groups and a text filter, but group names render as plain text and there is no `/reports/groups/[groupId]` route to honour the spec’s navigation target.
- Pupil overview (`src/app/reports/[pupilId]/report-view.tsx`) is far richer than the spec: it pulls success-criteria breakdowns, per-subject accordions, export/print options, and links units to `/units/[unitId]` instead of `/reports/[pupilId]/units/[unitId]`.
- There is no dedicated unit detail route; the success-criteria table lives inline behind a `<details>` toggle, so the new `/reports/[pupilId]/units/[unitId]` experience and deep linking do not exist.
- Current routes include `/reports/[pupilId]/groups/[groupId]` and related print/export flows that the spec does not mention; we need to decide whether to retire or repurpose them.
- A group-level report matrix (`/reports/groups/[groupId]`) is missing entirely; existing data loaders focus on per-pupil summaries and lesson-level submissions rather than a unit-by-unit cohort grid with sticky headers.

## 2. Server/Data Layer Updates
- Audit `readPupilReportAction` and helper pipelines in `src/app/reports/[pupilId]/report-data.ts`; refactor or supplement them so we can cheaply derive both the lightweight pupil overview (subjects → units with activity/assessment percentages and level) and the detailed unit success-criteria dataset for the new route without redundant Supabase calls.
- Design and implement a group report loader (`readGroupReportAction` in `src/lib/server-actions` or a sibling module) that retrieves group membership (pupils only), active assignments with unit metadata, and aggregated assessment scores/levels per pupil+unit. Reuse existing score utilities (e.g. `readLessonAssignmentScoreSummariesAction`, `getLevelForYearScore`) where possible.
- Verify the necessary schemas exist in `src/types/index.ts`; extend or create Zod shapes for any new response envelopes so UI code stays type-safe. Update `src/lib/server-updates.ts` to re-export any new actions.

## 3. Route & Component Changes
- Landing page: update `ReportsTable` so group ids render as links to `/reports/groups/[groupId]`, review the filter UX to ensure it covers the “pupils in a group” scenario (consider promoting a chip/dropdown if the current wildcard search feels opaque), and keep the teacher guard.
- Pupil overview (`/reports/[pupilId]`): simplify the layout to match the spec (subjects grouped, each unit row showing Title→new route link, description, activities %, assessment %, level). Remove or relocate export/print affordances unless the product team wants to preserve them explicitly.
- Unit detail route: add `/src/app/reports/[pupilId]/units/[unitId]/page.tsx` (and optional loading/error states) that pulls the prepared unit dataset, lists learning objectives & success criteria with pupil-specific activities/assessment scores, and surfaces overall unit totals. Share formatting helpers so percentages/levels stay consistent.
- Group matrix route: create `/src/app/reports/groups/[groupId]/page.tsx` rendering a scrollable table with sticky first column/header (leveraging Tailwind utilities). Rows = pupils, columns = units; each cell shows assessment percentage and derived level badge. Handle empty states (no assignments, no pupils) gracefully.
- Decide how to sunset or reuse `/reports/[pupilId]/groups/[groupId]` and print/export routes. If deprecated, remove their links and map old URLs to the new structure (redirects or Not Found handling) to avoid orphaned pages.

## 4. Styling & UX Considerations
- Ensure the redesigned tables remain accessible: proper table semantics, focus states on links, and readable contrast for sticky headers/levels. Reuse shared UI primitives (`src/components/ui`) and the `cn` helper for class composition.
- When adding sticky table sections, test on narrow viewports to confirm overflow behaviour and preserve horizontal scroll cues.
- Confirm percentage formatting and level badges align with existing conventions (e.g. reuse `formatPercent` helper or move it into a shared utility).

## 5. Testing & Validation
- Smoke test the new data loaders with representative seed data: pupil overview, unit detail, and group matrix should all render non-empty content in dev.
- If possible, add lightweight Playwright coverage (or at least manual QA scripts) for the navigation flow: landing → pupil → unit detail, and landing → group matrix.
- Validate that existing report exports/print flows still behave (or consciously retire them) after restructuring the data layer.

## 6. Documentation & Follow-up
- Update `specs/reports.md` with any clarifications surfaced during implementation (e.g. filter behaviour, handling missing percentages).
- Append a note in `specs/reports.md` or the Playbook summarising the new routes and data loaders so future contributors understand the redesigned flow.
- Capture open questions for product (e.g. fate of export/print, expected level format) before merging to avoid rework.

