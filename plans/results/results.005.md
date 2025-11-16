# Plan: Results Realtime Sync

## Goal
- Use Supabase Realtime so `/results/assignments/[group__lesson]` automatically reflects pupil submissions (text + uploads) and AI feedback posted via the `/api/mcp` webhook without manual refreshes.

## Current Understanding
- Pupil submissions currently rely on manual refresh or router refresh triggered by the teacher.
- Upload activities persist files in Supabase Storage and now sync a placeholder submission record; however, no realtime broadcast is emitted for those writes.
- AI feedback arrives via webhook/worker jobs that write to `submissions`, but the results page polls manually.

## Implementation Steps
1. **Channel design**
   - Define a deterministic channel name (e.g., `assignment_results:{groupId}:{lessonId}`) emitting events for any submission insert/update/delete relevant to that assignment.
   - Ensure payloads carry `{ assignmentId, activityId, pupilId, submissionId, status, score, submittedAt }` plus flags for upload presence or AI metadata.

2. **Server broadcasts**
   - When pupil submissions are processed (text answers, AI overrides, file uploads via new submission rows), emit a realtime event after Supabase writes succeed.
   - Extend `/api/mcp` webhook and AI worker completions to broadcast auto score updates with the same schema.
   - Reuse a helper (`broadcastAssignmentUpdate`) so all server actions follow the same channel + payload rules.

3. **Client subscription**
   - In `assignment-results-dashboard`, create a Supabase browser client subscription that listens to the assignment channel on mount, updates the local matrix when events arrive, and unsubscribes on unmount.
   - Handle both full payloads (patch cell in-place) and partial payloads (trigger targeted re-fetch of the affected cell or row using `readAssignmentResultsAction`).
   - Surface lightweight toasts/spinners when a background refresh runs due to a partial payload.

4. **Upload-specific wiring**
   - Ensure file uploads trigger broadcasts once the metadata submission row is created. When uploads are deleted, emit another event so `needsMarking` toggles back as expected.

5. **Failsafes & flags**
   - Hide the subscription behind a feature flag/env (`RESULTS_REALTIME_ENABLED`) so environments without Supabase Realtime fall back gracefully.
   - Log telemetry around subscription lifecycle (connect/disconnect errors) using existing TELEM hooks.

## Deliverables
- Spec-aligned realtime channel helper(s) on the server and broadcasts wired into submission mutations + AI webhook flows.
- Client-side subscription that updates cells (or refetches minimally) when pupil submissions or AI updates arrive.
- Feature flag plus documentation/test notes covering realtime vs. fallback behavior.
