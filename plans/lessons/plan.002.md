# Lesson Detail Data Retrieval Consolidation Plan

## Goals
- Reduce `/lessons/[lessonId]` hydration from ~23 network round trips (multiple Supabase selects plus storage list) to 1–2 calls by introducing a Postgres RPC that returns all lesson detail data in a single JSON payload.
- Maintain server-side rendering: `LessonDetailPage` should still fetch data via server actions, keeping Supabase credentials off the client.
- Preserve telemetry expectations (function name, params, timing deltas) while simplifying where measurements occur.

## Implementation Plan
1. **Design the RPC contract**
   - Define a Supabase SQL function `lesson_detail_bootstrap(lesson_id uuid)` under `supabase/migrations` that selects lesson core fields, unit metadata, sibling lesson navigation data, learning objectives with success criteria, lesson activities (including `is_summative` flags and linked success criteria), and lesson links.
   - Join against `storage.objects` (or use `storage.list` via `postgres_fdw` equivalent) so the RPC also returns lesson file metadata (name, path, timestamps, size), eliminating the separate `listLessonFilesAction`.
   - Shape the RPC output as a single JSON object that mirrors what `LessonDetailClient` currently receives; document the structure alongside `specs/lessons/spec.000.md`.
2. **Extend RPC to cover reference data**
   - Limit learning objective and assessment objective data to the curricula explicitly linked to the lesson (no cross-curriculum browsing within this payload).
   - Decide whether curricula and assessment objectives belong in the same RPC response or in auxiliary RPCs (e.g., `curricula_bootstrap`, `assessment_objectives_bootstrap`). If they change infrequently, mark them cacheable or return them inside the main payload with version metadata.
3. **Update server actions**
   - Rewrite `readLessonAction` to call the new RPC via `supabase.rpc("lesson_detail_bootstrap", { lesson_id })`, normalize the JSON, and return the `{ data, error }` envelope.
   - If curricula/assessment objectives remain separate RPCs, introduce lightweight server actions that call those endpoints once and memoize results with `cache()` to avoid repeated DB trips.
   - Remove `listLessonFilesAction` usage in `LessonDetailPage` since file metadata is embedded in the RPC response; retain the action only if other routes still need direct storage access.
4. **Refactor `LessonDetailPage`**
   - Replace the `Promise.all` fan-out with a single await on the updated `readLessonAction` (plus files if separate). Ensure error handling and `notFound()` behaviour mirror current logic.
   - Validate that `LessonDetailClient` props align with the reorganized payload; adjust prop names/types if necessary.
5. **Telemetry & logging**
   - Wrap the RPC call(s) with `withTelemetry`, ensuring the route tag stays `/lessons/[lessonId]` and the function names describe the consolidated actions (e.g., `LessonDetailPage.bootstrap`).
   - Confirm telemetry captures the new single-call timing and still respects `TELEM_ENABLED` / `TELEM_PATH`.
6. **Migration, testing, docs**
   - Add SQL migration(s) for the RPC(s) and include sample JSON fixtures for local validation.
   - Update specs (`specs/lessons/spec.000.md`) with the finalized flow (already drafted in this iteration) and note any environment variables or caching expectations.
   - Smoke-test `/lessons/[lessonId]` to ensure the page renders with the new payload and that error states/logs behave as before.

## Risks & Mitigations
- **Large payload sizes:** paginate or trim unused columns in the RPC; compress arrays where feasible.
- **Cache staleness:** when caching curricula/assessment objectives, invalidate caches when related mutations run (e.g., via `revalidatePath` or version stamps in the RPC response).
- **RPC complexity:** keep the SQL readable by breaking subqueries into CTEs (e.g., `lesson_base`, `activities_with_sc`, `objectives_with_sc`) and include comments for future maintainers.

## Open Questions
- None at this time.
