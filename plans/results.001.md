# Assignment Results Dashboard Plan (v2)

## 1. Data Contracts & Aggregation
- Use existing Supabase queries/helpers inside a new server action to assemble the pupil × activity matrix for the requested assignment; avoid database views for now.
- Ensure `src/types/index.ts` includes schemas for `AssignmentResultMatrix`, `AssignmentResultRow`, and `AssignmentResultCell` reflecting the 0–1 score scale and metadata needed for overrides.
- Derive assignment, group, and lesson details via current `lesson_assignments` lookups and gather pupil rosters plus scorable activities in a consolidated server-side payload.

## 2. Server Actions & Mutations
- Implement `readAssignmentResultsAction` in `src/lib/server-actions/assignment-results.ts`:
  - Validate `assignment_id` with Zod.
  - Guard with `requireTeacherProfile`.
  - Fetch pupils, scorable activities, and their scores (auto and overridden) using existing Supabase helpers.
  - Shape the response `{ assignment, lesson, group, pupils, activities, matrix }`.
- Add `overrideAssignmentScoreAction` (0–1 inclusive) that persists overrides using the current assignments tables, and an optional `resetAssignmentScoreAction` that clears overrides to the original score.
- Re-export the new actions from `src/lib/server-updates.ts` and update callers to import from the barrel.

## 3. Routing & Access
- Create `src/app/results/assignments/[assignmentId]/page.tsx` to load the matrix on the server and pass serialisable props to a client dashboard component.
- Add `loading.tsx` and `not-found.tsx` siblings for skeleton and invalid-access handling.
- Wire navigation links from Assignment Manager and any relevant breadcrumbs to `/results/assignments/{assignment_id}` for quick access.

## 4. Client UI & Matrix Experience
- Build `AssignmentResultsDashboard` under `src/components/assignment-results/` with:
  - Header summarising assignment, group, lesson, and aggregate stats.
  - Sticky first column for pupils (avatar, name, submission status) plus an average row.
  - Scrollable grid with columns for scorable activities only; apply color rules: green >0.7, red <0.3, yellow otherwise, grey for unmarked scorable cells.
  - Column totals/averages and optional controls (e.g., column visibility toggles).
- Ensure responsive layout with sticky headers and accessible table semantics (keyboard navigation, focus rings).

## 5. Cell Inspector Sidebar
- Implement a right-side drawer that opens on cell click using existing UI primitives (e.g., `Sheet`).
- Display activity metadata, the current 0–1 score (color-coded), and status (auto vs. overridden).
- Provide numeric input limited to 0–1 and optional feedback textarea; include `Save`, `Reset`, and `Cancel` actions tied to the new server mutations.
- Use `useTransition` for optimistic updates, show toast notifications, and revert state on failure.
- Grey cells (unmarked scorable activities) should direct teachers to enter a score via the drawer.

## 6. Edge Cases & Performance
- Hide non-scorable activities from the matrix entirely.
- Handle pupils without submissions by showing a grey or neutral status and enabling manual overrides.
- Defer heavy optimisation (virtualization/pagination) until we understand real group sizes; keep layout components flexible for follow-up tuning.
- Ensure timezone-safe display of timestamps if we later surface them, even though audit metadata is not required right now.

## 7. Testing & QA
- Add Playwright coverage for navigating to the results dashboard, verifying matrix rendering, and performing a score override + reset workflow.
- Seed representative assignments with scorable and non-scorable activities in `supabase/seed.sql` to support deterministic tests.
- Run `npm run lint` and `npm run test` before shipping; capture Playwright traces if sidebar interactions appear flaky.

## 8. Documentation & Rollout
- Update `src/releases.md` and the Planner Agents Playbook with the new dashboard behaviour, score band definitions, and override workflow.
- Communicate the new `/results/assignments/:assignmentId` route via specs (e.g., `specs/activities-feedback.md`) and product notes.
- Coordinate Supabase migrations only if later iterations require additional metadata (e.g., auditing) and schedule follow-up optimisation work once usage metrics are known.
