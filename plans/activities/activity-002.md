# Activity Scoring Overhaul Plan (v2)

> Requirement: Scores must always be persisted per success criterion. Activity-level scores become derived values only.

## 1. Type & Schema Updates
- Extend `src/types/index.ts` with `ActivitySuccessCriterionScoreSchema` and update submission/result types to require `successCriteriaScores: Record<string, number | null>`, removing single-score fallbacks.
- Ensure MCQ and short-text submission bodies (and any other scored activity payloads) include both `activityScore` (derived) and `successCriteriaScores` (authoritative), defaulting null values to 0 for averages.
- Review Supabase row typing; if necessary, formalize the JSON structure inside `submissions.body` to house per-criterion scores and overrides.

## 2. Data Model & Storage
- Confirm all server actions that read/write submission data (`submissions`, `short-text`, `assignment-results`) persist per-criterion scores and never rely solely on a single numeric value.
- Introduce helper utilities (e.g., `normaliseSuccessCriteriaScores(activity, score)`) to guarantee that every linked success criterion has a stored score (0 when missing).
- Document the JSON contract for per-criterion scores, including override metadata, in a shared constants module.

## 3. Scoring Logic Changes
- Update MCQ and short-text auto-scoring routines to populate `successCriteriaScores` by writing the same computed value to each linked success criterion (0–1). `activityScore` becomes the average of these stored scores.
- Expand override APIs so they accept arrays of `{ successCriteriaId, score, feedback? }`, updating both the per-criterion map and the derived activity score.
- Rework average calculations (per pupil, per activity, success criteria summaries) to use persisted per-criterion scores, treating null/undefined as 0.

## 4. UI & Interaction
- Results sidebar: display each success criterion with independent score inputs, reflecting stored values and allowing teacher overrides per criterion.
- Results grid headers: continue listing success criteria but ensure hover/tooltips indicate stored values vs. derived averages.
- Lesson activity editors or existing override UIs should surface per-criterion scores where applicable (short-text grading panel, etc.).

## 5. Backfill & Compatibility
- Craft a migration/backfill script to convert legacy submissions that only have `activityScore` into the new per-criterion map by copying the single value to every linked success criterion.
- Build an idempotent reconciler for lessons where success criteria links changed after submissions were made (e.g., ensure new criteria start at 0).
- Add safeguards that fail validation if a submission lacks the per-criterion score map going forward.

## 6. Testing & QA
- Unit/integration tests covering: auto-scoring writes per-criterion values, teacher overrides update only targeted criteria, averages treat missing as 0.
- Playwright scenarios to edit per-criterion scores via the sidebar and verify the grid/summary updates.
- Regression checks ensuring existing analytics/export consumers handle the new structure (or are updated accordingly).

## 7. Documentation & Change Management
- Update `specs/acticvites.md` and Planner Playbook with the per-criterion persistence contract, including JSON examples.
- Communicate API and data shape changes to downstream teams, and add release notes describing the scoring overhaul.
- Provide a migration guide for any custom scripts relying on the old single-score format.
