# Activity Scoring Overhaul Plan

## 1. Type & Schema Updates
- Review `src/types/index.ts` to ensure activity submission payloads can capture per-success-criterion scores. Introduce `ActivitySuccessCriterionScoreSchema` and augment `AssignmentResultCell` or new structures to store arrays of criterion scores.
- Update Zod schemas for MCQ and short-text submissions so calculated scores populate a `successCriteriaScores` map keyed by success criterion id.
- Ensure any Supabase row typing (e.g., `activity_success_criteria`, `submissions`) reflects the new structure; plan migrations only if raw storage needs to change.

## 2. Data Model & Storage
- Decide whether to persist per-criterion overrides directly in `submissions.body` JSON (preferred for now) or via a new table. Document the chosen approach.
- Audit existing server actions (`short-text`, `submissions`, `assignment-results`) to read/write the new payload fields while keeping legacy data backward compatible.
- Add helper utilities to derive per-criterion score arrays given an activity’s success criteria, defaulting to the overall score when only a single value exists.

## 3. Scoring Logic Changes
- Update MCQ and short-text auto-scoring routines to fan out the calculated 0–1 score to every linked success criterion by default.
- Extend override APIs so teachers can adjust scores per success criterion. This likely means expanding `overrideAssignmentScoreAction` (or creating a new endpoint) to accept arrays of `{ successCriteriaId, score }`.
- Adjust average calculations in results dashboards and analytics so they aggregate per-criterion scores, treating null as 0 per the spec.

## 4. UI & Interaction
- Modify the results sidebar to surface success-criterion scores individually with editing controls (slider/input per criterion).
- Update assignment results grid and success criteria summary cards to pull the new per-criterion data.
- Ensure lesson activity editors and any existing override UI (e.g., short-text sidebar) reflect the more granular scoring.

## 5. Backfill & Compatibility
- Write a migration/backfill script that, for existing submissions, duplicates the single activity score across all linked success criteria to maintain continuity.
- Craft idempotent scripts to patch legacy records stored in `submissions.body` without per-criterion data.

## 6. Testing & QA
- Add integration tests covering per-criterion scoring: auto-calculated MCQ/short-text, teacher overrides, and average computations including null-as-zero cases.
- Update Playwright specs for the results dashboard to verify criterion-level editing and display.

## 7. Documentation & Change Management
- Update `specs/acticvites.md` (already started) and Planner Playbook to describe the new scoring contract.
- Communicate API shape changes to downstream consumers (analytics, exports) and prepare release notes summarizing the per-criterion scoring rollout.
