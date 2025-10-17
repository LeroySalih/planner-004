# Scoring Overhaul Plan – Assessment vs Total

## 1. Domain Decisions & Data Contracts
- Audit `activities.is_summative` usage and document the new scoring rules: activity totals still include every scorable activity, but *assessment* lesson and unit totals must only consider records where `is_summative = true`.
- Extend Zod schemas so lesson/unit summary payloads expose both `totalAverage` (all scored activities) and `summativeAverage` (assessment-only). Update type aliases so components cannot ignore the new fields (`src/types/index.ts`).
- Decide on rounding/formatting strategy (retain raw 0–1 values, push formatting to UI) and capture it in `specs/scoring.md` for future contributors.

## 2. Supabase & Persistence
- Confirm the `activities` table already stores `is_summative`; if any historical rows are `NULL`, backfill to `false` via migration to avoid branching logic.
- Keep all lesson and unit score calculations in memory—no new tables or persisted rollups. Ensure any Supabase queries only fetch raw submissions and success-criteria data needed to compute totals per request.
- Revisit index coverage (`activities (lesson_id, is_summative)`) only if runtime performance degrades, since we are recalculating on the fly.

## 3. Server Actions & Aggregations
- Update `readLessonSubmissionSummariesAction` to emit both averages: recompute totals twice (once across all scored activities, once filtering `is_summative` IDs). Thread the new values through to consumers.
- Enhance assignment results builder (`readAssignmentResultsAction`) so `activitySummaries`, `successCriteriaSummaries`, and `overallAverage` clarify total vs. summative, exposing `{ totalAverage, summativeAverage }`, with both derived at request time.
- Introduce reusable helpers in `src/lib/scoring/success-criteria.ts` for “filter to summative” and “average with null=0” to keep calculations consistent.
- Create a new server action that produces per-unit aggregates: gather lessons → activities → submissions and return both totals, computed in-process and never persisted. Export from the server-updates barrel for UI use.

## 4. Client Updates
- Update lesson feedback dashboards and assignment results UI to display both totals (e.g., pill badges: “Overall 62% | Assessment 58%”) while preserving existing styling cues.
- Ensure any badges or progress meters that feed the level-calculation workflow can specify whether they consume total or assessment averages; add props/defaults accordingly.
- Surface assessment filtering in teacher dashboards (e.g., toggle that highlights assessment activities, or separate columns).

## 5. Level & Unit Integration
- Adjust the pathway that maps percentages to levels (per `specs/calc-levels.md`) to accept both totals and assessment averages. Decide which one drives progression by default and expose a configuration constant.
- If unit dashboards currently rely on placeholder averages, replace them with the new server action response. Add unit-level callouts for “Assessment average” to align staff expectations.

## 6. Testing & Validation
- Add server-action tests that mock submissions with mixed assessment flags to verify the two averages diverge as expected.
- Extend Playwright coverage for assignment results: create activities with mixed `is_summative` flags, ensure UI renders both totals, and confirm override flows update the right calculations.
- Capture edge cases: no assessment-tagged activities (assessment average returns `null`), all assessment, and mixed overrides/AI scores.

## 7. Documentation & Rollout
- Update `specs/scoring.md` to reflect all new terminology, examples, and UI expectations once implementation lands.
- Add release notes detailing the change in lesson/unit averages so stakeholders know assessment data now drives progression.
- Communicate any migration or backfill steps to ops (e.g., rerun `bin/dev_db_sync.sh` after schema updates).
