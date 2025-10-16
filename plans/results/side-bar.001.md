# Assignment Results Sidebar Override Plan (v1)

## 1. Current State & Requirements
- Inspect `src/components/assignment-results/*` to confirm how the sidebar renders submission details, score overrides, and feedback when a submission exists.
- Trace the data dependencies from the results page (`src/app/results/assignments/...`) back through server actions in `src/lib/server-actions/assignment-results.ts` (or equivalent) to understand how `submission`, `override_score`, and `feedback` are supplied.
- Verify Zod schemas in `src/types/index.ts` (e.g., `LessonAssignments`, `LessonFeedbackSummaries`, submission-related types) to see how missing submissions are represented and whether teacher-created submissions need additional flags.
- Capture any constraints from Supabase schema (tables for lesson assignments, submissions, feedback) that affect inserting a teacher-authored submission.

## 2. Data Model & Schema Considerations
- No database migration required: the existing `submissions` table already supports teacher-authored records via its `body` JSON payload and basic metadata.
- Confirm `SubmissionSchema` (`src/types/index.ts`) remains accurate once override submissions populate the same fields (`submitted_at`, `body`) as learner submissions; update type docs only if we introduce new shape conventions in the `body`.
- Decide whether to add a lightweight flag (e.g., `teacherCreated: boolean`) inside the submission body to help the UI distinguish new entries; document the shape in comments or shared types if adopted.

## 3. Server Actions & Mutations
- Update the existing score override action (likely `overrideAssignmentScoreAction`) to:
  - Accept overrides when `submission_id` is missing by creating a new submission record linked to the pupil, assignment, and activity with sensible defaults (status, timestamps, author flags).
  - Persist override score and optional feedback in the same transaction as the new submission creation to avoid dangling records.
  - Return the new submission payload so UI state can refresh immediately.
- Ensure any reset action handles teacher-created submissions appropriately (e.g., delete the submission or clear override fields, depending on product expectations).
- Re-export modified actions via `src/lib/server-updates.ts` and adjust any callers to accommodate the updated response shape.
- Add server-side guards (`requireTeacherProfile`) if they are not already enforced on the override endpoint.

## 4. Client UI & Sidebar Behaviour
- Adjust the sidebar component to allow editing score and feedback even when `submission` was previously `null` by:
  - Displaying a "No learner submission yet" banner but keeping the override form active.
  - Handling optimistic state for the newly created submission so the UI reflects the teacher override immediately.
  - Ensuring validation accommodates empty previous scores/feedback and highlights required fields (if any) before saving.
- Update any derived state or hooks that assumed an existing submission (e.g., `useMemo` caches, disabled buttons, derived timestamps).
- Confirm the drawer/Sheet interaction still works for other cases (existing submissions, resets, error handling).

## 5. Tests & QA
- Enhance Playwright coverage (e.g., `tests/results/assignment-sidebar.spec.ts`) to cover:
  - Opening a pupil with no submission.
  - Entering override score/feedback and verifying the UI reflects the newly created submission state.
  - Resetting or editing the override afterwards.
- Seed test data with a pupil lacking submissions to make the scenario deterministic.
- Run `npm run lint` and `npm run test`; capture traces if the sidebar workflow is flaky.

## 6. Documentation & Follow-up
- Append the new override behaviour to the Planner Agents Playbook, explaining the teacher-created submission flow and any new schema fields.
- Update release notes or in-app guidance if teachers need to know about the new capability.
- Monitor for edge cases (e.g., multiple teacher overrides before save, concurrent overrides) and plan future resilience improvements if necessary.
