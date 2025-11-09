# Plan: Results Sidebar Enhancements

## Goals
- Align the assignments/results sidebar with the latest spec (Question, Automatic Score, Override tabs plus activity metadata).
- Keep the existing data flow architecture (RPC bootstrap + optimistic updates + async cache recalcs) while extending it to supply the new sidebar data.
- Ensure telemetry, optimistic UI, and teacher-only auth remain intact.

## Current Understanding
- Sidebar lives in the results/assignments page (`src/app/results`, `src/components/assignment-manager/...`); feedback overrides reuse Assignment Manager patterns.
- `readAssignmentResultsAction` shapes the sidebar payload today; it needs to keep returning sanitized question text plus activity metadata, while uploads can lean on the existing `listPupilActivitySubmissionsAction` server helper for on-demand file listings.
- Feedback writes already trigger async recalculation jobs to refresh cached report data; telemetry is wrapped via `withTelemetry`.

## Implementation Steps
1. **Validate Schemas & Types**
   - Confirm `ActivityFeedback`, `LessonAssignmentScoreSummaries`, etc. in `src/types/index.ts` already include sidebar needs (question text, uploads, override metadata).
   - If gaps exist (e.g., success criteria list or auto/override flags), extend the Zod schemas and regenerate inferred types, ensuring Supabase RPC contracts match.

2. **Server/Data Flow Updates**
   - Extend `readAssignmentResultsAction` to sanitize question text, expose auto vs override markers, and include upload instructions so the Question tab always has copy to render.
   - Fetch upload submissions on-demand with `listPupilActivitySubmissionsAction`/`getPupilActivitySubmissionUrlAction`, caching signed URLs per `{pupilId, activityId}` until the teacher hits refresh.
   - Keep the async cache recalculation pipeline unchanged; only pass any new fields needed by `/reports` so downstream tables stay consistent.
   - Update any server action wrappers touching feedback overrides so they capture override reasons/values used in the new UI, and continue to enqueue report-cache work.

3. **Client Sidebar UX**
   - Update the Assignment Results dashboard (`src/components/assignment-results/assignment-results-dashboard.tsx`) to:
     - Display activity metadata header (title, status, auto/override chip) and keep the Question/Automatic/Override tabs in sync.
     - Implement the override + reset flows with `useActionState` so buttons show pending states while optimistic updates apply.
     - Question tab: show prompt, pupil response, download link for uploads.
     - Automatic Score tab: show auto score explanation and timestamp if available.
     - Override tab: render success-criteria buttons (0 / 50% / 100%) plus numeric input + text feedback area; wire submit action to server.
   - Ensure optimistic updates mirror Assignment Manager behavior and that toasts fire via `sonner`.

4. **Telemetry & Auth**
   - Verify all touched server actions remain wrapped with `withTelemetry`, logging function name + params + timing deltas gated by `TELEM_ENABLED/TELEM_PATH`.
   - Confirm routes stay behind `requireTeacherProfile()` and avoid duplicate guard calls by passing the profile through.

5. **QA & Documentation**
   - Add/update Playwright spec covering sidebar interactions (tab switching, override submission, file download link presence).
   - Document any new workflows or RPC expectations in `specs/results/general.000.md` and reference this plan if process changes.

## Open Questions / Follow Ups
- None at this time.
