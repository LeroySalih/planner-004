# Plan: Unified Feedback Storage & Consumption

## Goals
- Move all assignment feedback (teacher overrides, automatic AI responses, manual comments) into the single `pupil_activity_feedback` table described in `specs/ai-marking/general.000.md` so downstream consumers always read a consistent record per pupil/activity/source.
- Update scoring/marking server actions and webhooks so they append feedback entries instead of mutating `teacher_feedback` / `ai_model_feedback` inside `submissions.body`.
- Ensure the Assignment Results matrix, pupil lesson views, and reporting pipelines compute scores/feedback/rich text from the new table without regressing existing overrides or optimistic UI flows.

## Current Understanding
- Short-text submission bodies store `teacher_feedback`, `ai_model_feedback`, and `ai_model_score` (see `ShortTextSubmissionBodySchema` in `src/types/index.ts`), and `extractScoreFromSubmission` in `src/lib/scoring/activity-scores.ts` pulls these strings to populate `feedback` / `autoFeedback`.
- Teacher overrides and comments are persisted by `mutateAssignmentScoreAction` (`src/lib/server-actions/assignment-results.ts` around lines 1120-1250) which writes both `teacher_override_score` and `teacher_feedback` back into the submission JSON.
- AI results arrive through `src/app/webhooks/ai-mark/route.ts`, updating `ai_model_score`/`ai_model_feedback` on submissions and triggering realtime events; there is no separate durable record of which source produced which note.
- UI components such as `src/components/assignment-results/assignment-results-dashboard.tsx` expect each cell to contain `feedback`, `autoFeedback`, `overrideScore`, etc., all derived from submissions. Realtime updates piggyback on submission writes.
- Reporting (`src/lib/server-actions/reports.ts`) and pupil lesson summaries (`src/lib/pupil-lessons-data.ts`) consume aggregated feedback from Supabase RPCs that ultimately read the same submission JSON or legacy `feedback` table rows.
- We currently lack a `pupil_activity_feedback` table/migration, so adopting the spec requires both schema changes and data backfill/reads.

## Implementation Steps
1. **Design & Migrate Schema**
   - Create `pupil_activity_feedback` with columns `feedback_id (uuid)`, `activity_id`, `lesson_id`, `group_assignment_id`, `pupil_id`, `submission_id`, `source enum ('teacher','auto','ai')`, `score numeric`, `feedback_text text`, `created_at`, `created_by`.
   - Add supporting indexes (activity+pupil, submission_id) and RLS policies mirroring `submissions`.
   - Write a migration/backfill script to seed the table from existing submission bodies (`teacher_feedback`, `ai_model_feedback`) and legacy `feedback` rows so historical context is preserved.

2. **Update Types & Shared Utilities**
   - Extend `src/types/index.ts` with a Zod schema / inferred type for `PupilActivityFeedback`.
   - Add helpers in `src/lib/feedback` (new module) to fetch the latest feedback per activity/pupil and to append entries from server actions.
   - Update `extractScoreFromSubmission` so it sources textual feedback from the helper (latest table row) instead of parsing `teacher_feedback` / `ai_model_feedback`.

3. **Write APIs for Feedback Writes**
   - Introduce server-side helpers (e.g., `recordFeedbackEntry`) that insert into `pupil_activity_feedback` with telemetry + error envelopes.
   - Update `mutateAssignmentScoreAction`, short-text save flows (`src/lib/server-actions/short-text.ts`), and any other teacher-facing mutation to call the helper whenever feedback text or override score is set, ensuring submissions only keep structural score data.
   - Adjust `/webhooks/ai-mark` so each AI result both updates submission scores and inserts an `"ai"` feedback row; ensure realtime payloads include enough data for clients to refresh textual feedback.

4. **Rework Read Paths**
   - Modify `readAssignmentResultsAction` (and the RPCs it invokes) to join or post-process `pupil_activity_feedback`, returning `latestFeedback` and `latestFeedbackSource` fields used by `assignment-results-dashboard`.
   - Update `src/lib/pupil-lessons-data.ts`, report builders, and any RPC JSON shaping to rely on the table instead of submission JSON fields.
   - Ensure realtime events (both Supabase and local optimistic updates) trigger when new feedback rows exist so the UI stays synced without requiring page reloads.

5. **Client/UI Changes**
   - Refactor assignment results cells to display the text/source coming from the new API shape; keep existing optimistic override UX by inserting provisional rows (source `"teacher"`) before the server confirms.
   - Update any components that let teachers edit feedback to call the new helper/Action; ensure forms still use `useActionState` loaders and toasts.
   - Confirm the pupil view respects assignment `feedback_visible` flags while reading from `pupil_activity_feedback`.

6. **Validation & Migration Strategy**
   - Provide scripts/tests to verify backfilled data counts per activity/pupil match old submission `teacher_feedback` occurrences.
   - Add telemetry/logging around the new helper to monitor insert latency and failures.
   - Document rollback/cleanup steps in the playbook once code ships (e.g., eventually stop writing `teacher_feedback` / `ai_model_feedback` into submissions after clients switch).

## Deliverables
- Supabase migration (and optional background job) creating/backfilling `pupil_activity_feedback`.
- Updated TypeScript helpers, server actions, and webhook logic to write/read the unified table.
- UI adjustments and realtime wiring ensuring teachers and pupils see consistent feedback regardless of source.
- Documentation updates (AGENTS.md or specs) summarizing the new feedback data flow and any operational checklists.
