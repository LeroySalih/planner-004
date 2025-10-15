# Assignment Results Dashboard Plan

## 1. Data Contracts & Aggregation
- Confirm `Assignments`, `LessonAssignments`, `LessonFeedbackSummaries`, and pupil roster schemas cover all fields needed to look up group, lesson, and per-activity grading context. Extend `src/types/index.ts` with `AssignmentResultRowSchema`, `AssignmentResultCellSchema`, and a parent `AssignmentResultMatrixSchema` if the current contracts lack aligned structures.
- Derive the assignment’s owning `group_id` and `lesson_id` from `lesson_assignments` using the passed `assignment_id`. Add any missing Supabase view or query helpers to fetch related pupils (`group_members`) and graded activities in one round trip.
- Define a deterministic color/status mapping for score bands (e.g., 0–50 red, 50–79 yellow, 80–100 green) that will be shared between the grid and the sidebar badge; house this in `src/lib/results/colors.ts` or similar.

## 2. Server Actions & Loaders
- Create `src/lib/server-actions/assignment-results.ts` exporting `readAssignmentResults` that (a) validates the input assignment id with Zod, (b) enforces `requireTeacherProfile`, (c) loads pupils, graded activities, and scores, and (d) shapes the matrix `{ assignment, lesson, group, pupils, activities, matrix }`.
- Re-export the action from `src/lib/server-updates.ts` and ensure caller components only need a single async entry point for results.
- For score overrides, add `overrideAssignmentScoreAction` (accepts pupil, activity, score, feedback) and `resetAssignmentScoreAction` if we support reverting to auto-graded results. Both should record teacher overrides in the existing Supabase tables (or introduce a new table if required).
- Extend existing Supabase RPC/stored procedures or write SQL queries to return all activity scores per pupil in one payload to minimise client fetches.

## 3. Routing & Authorization
- Introduce a new App Router segment `src/app/results/assignments/[assignmentId]/page.tsx`. This server component should (a) guard with `requireTeacherProfile`, (b) call `readAssignmentResults`, and (c) pass serialisable props to a client component for interactive rendering.
- Provide a loading skeleton (`loading.tsx`) that mirrors the table structure and a not-found boundary (`not-found.tsx`) if the assignment id is invalid or not owned by the teacher.
- Update navigation surfaces (Assignments lists, breadcrumbs) to link to `/results/assignments/{assignment_id}` so teachers can access the dashboard from familiar entry points.

## 4. Client UI & Grid Experience
- Build a `AssignmentResultsDashboard` client component under `src/components/assignment-results/` composed of:
  - Header block showing assignment name, lesson, group, and aggregate totals.
  - Sticky first column listing pupils (avatar + name + status) and an average row.
  - Scrollable grid body where columns represent scored activities; use Tailwind CSS grid or table layout with sticky headers, and color-coded cells driven by the shared score bands.
  - Column totals/averages row and optional column selector to hide/show activities.
- Ensure responsiveness (horizontal scrolling with sticky first column/header) and accessibility (table semantics, focus indicators).

## 5. Cell Inspector Sidebar
- Implement a right-aligned `Drawer`/`Sheet` component (reuse existing UI primitives) that opens when a cell is clicked. Populate it with:
  - Activity details (name, prompt, score scale) and the current pupil score with color-coded badge.
  - Form controls to override the score (numeric input/slider within valid range) and optional textual feedback area, with validation against the schema.
  - Control buttons for `Save override`, `Reset to auto score`, and `Cancel`.
- Handle optimistic updates using `useTransition` and local matrix state while awaiting server confirmation. Show toast notifications for success/failure and revert on error.
- Display audit info such as who last modified the score and when, if available; capture this metadata in the server action response.

## 6. Edge Cases & Performance
- Support assignments that include activities without scores (display icon/tooltip and disabled interaction).
- Gracefully handle pupils without submissions by showing “Not submitted” status and supporting manual override.
- Paginate or virtualize the grid if groups exceed a threshold (e.g., >40 pupils or >25 activities) to keep rendering performant; evaluate Radix ScrollArea plus windowing with `react-virtual`.
- Ensure timezone-aware timestamps for overrides so teachers see accurate auditing.

## 7. Testing & QA
- Add Playwright coverage: navigating from Assignments list to Results dashboard, verifying grid data renders, and exercising the sidebar override flow (enter score, save, confirm toast, verify grid updates).
- Where feasible, seed representative assignments in `supabase/seed.sql` so tests have stable fixtures covering multiple pupils/activities.
- Run `npm run lint` and `npm run test` to validate changes; capture traces for the new Playwright spec if the sidebar interactions prove flaky.

## 8. Documentation & Rollout
- Append a summary of the Assignment Results workflow to `src/releases.md` and update the Planner Agents Playbook with the new results dashboard conventions (data contracts, color logic, override semantics).
- Communicate the new route to stakeholders by updating relevant specs in `specs/activities-feedback.md` or creating a dedicated results spec.
- Coordinate with Supabase migration/versioning so schema changes land before deploying the UI, and ensure production data backfill scripts accommodate the override metadata.

## Open Questions
- Do existing `Assignments`, `LessonAssignments`, and score-related tables already expose the per-activity pupil matrix, or will we need new Supabase views/queries to gather this data efficiently?
- Which score band thresholds and matching colors align with current design tokens so the grid and sidebar stay consistent with planner visuals?
- Where should manual score overrides live—can current tables record override values and metadata, or is a new Supabase migration/table required?
- What score range and precision (integers vs. decimals, per-activity maxima) must the override form enforce?
- Is audit data such as “last modified by/at” already captured for scores, or do we need schema changes to surface this in the sidebar?
- How should activities without auto-generated scores appear—disabled cells within the grid or hidden unless toggled on?
- At what pupil/activity counts do we need to introduce virtualization or pagination to keep the grid performant, and which approach should we adopt?
