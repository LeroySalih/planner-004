# Plan: Add Short Text Feedback MCP Tool

## Context
- `specs/mcp/short-text-feedback.md` defines a new `feedback_short_text` MCP tool that streams JSON feedback containing assignment, activity, and pupil identifiers plus a 0–1 score and narrative feedback.
- The MCP server already exposes curriculum/LOSC tooling via `/api/MCP/*`; we need to extend it and store each AI feedback run for auditing/telemetry.
- Short-text submissions currently live in `submissions` rows with a JSON `body` that captures `answer`, `ai_model_score`, and `ai_model_feedback`; there is no first-class history table for MCP-triggered evaluations.

## Proposed Steps
1. **Schema & Supabase Updates**
   - Create a migration that adds a `short_text_feedback_events` table with columns: `feedback_event_id` (PK), `assignment_id`, `lesson_id`, `activity_id` (FK to `activities`), `submission_id` (FK to `submissions`), `pupil_id` (FK to `profiles.user_id`), `activity_question`, `activity_model_answer`, `pupil_answer`, `ai_score`, `ai_feedback`, `request_context` (JSONB for MCP metadata), and timestamps. Index by `(activity_id, pupil_id)` and `(assignment_id, pupil_id)` for quick lookups.
   - Extend seeds so local dev has at least one populated event row tied to existing short-text lessons for smoke testing.
   - Add a SQL function (e.g., `get_latest_short_text_submission(activity_id uuid, pupil_id uuid)`) that returns the latest submission body along with the activity's model answer so the MCP service can auto-populate any missing `activity_question`, `activity_model_answer`, or `pupil_answer` fields before scoring.
2. **Types & Validation**
   - Define Zod schemas in `src/types/index.ts` for `ShortTextFeedbackEvent` and `ShortTextFeedbackRequest`, mirroring the DB structure and MCP spec (assignment_id, pupil_id, activity_id, question, model answer, pupil answer, score, feedback).
   - Export a type-safe DTO to reuse in both the Supabase service helper and the API route.
3. **Service-layer Helper**
   - Add `src/lib/mcp/short-text-feedback.ts` that wraps `createSupabaseServiceClient()` to: (a) hydrate question/answer data via the new SQL function whenever the request omits any of those fields, (b) reuse the existing `scoreShortTextAnswers` helper to produce `score`/`feedback`, (c) persist the event row on every invocation, and (d) return the response payload for streaming (including a `populated_from_submission` flag).
   - Ensure helper attaches telemetry metadata (`functionName`, `params`) and logs failures with the `[mcp-feedback]` prefix.
4. **API Route & Discovery**
   - Create `src/app/api/MCP/feedback/short-text/route.ts` accepting `POST` only. Validate auth via `verifyMcpAuthorization`, parse the request body with the new schema, and invoke the helper under `withTelemetry` (`routeTag` `/api/mcp/feedback/short-text`).
   - Stream the JSON result with `streamJsonResponse` so the MCP client receives incremental chunks; surface structured errors for missing IDs or Supabase/AI failures.
   - Update `src/app/api/MCP/route.ts` `TOOLS` array to include the new `feedback_short_text` entry with method/path metadata from the spec.
5. **Docs, Telemetry & Verification**
   - Document the tool in `specs/mcp/general.md` (and/or add a dedicated README under `specs/mcp`) so future agents know about required headers, payload shape, and persistence expectations.
   - Confirm telemetry logging writes to `logs/telem_<timestamp>.log` when `TELEM_ENABLED` is set and that the new `routeTag` respects `TELEM_PATH` filtering.
   - Smoke-test locally via `curl -X POST http://localhost:3000/api/MCP/feedback/short-text` with sample payload, then inspect Supabase to ensure `short_text_feedback_events` captures the run.
