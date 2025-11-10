# `/pupil-lessons` data-retrieval plan

## Objectives
- Collapse the dozens of Supabase client calls on `/pupil-lessons/[pupilId]` into 1–2 RPC invocations so the DB performs the heavy joins/aggregations.
- Keep response payloads aligned with existing Zod contracts (`PupilLessonsSummary`, `PupilLessonsDetail`) to avoid large UI changes.
- Preserve telemetry hooks (`withTelemetry`) and the existing server-action entry points so the rest of the app continues to import from the same barrel.

## Current pain points
1. `loadPupilLessonsSummaries` fans out to:
   - `readGroupsAction`
   - `readLessonAssignmentsAction`
   - `readGroupAction` per group (`G` calls)
   - `readLessonAction` per lesson (`L` calls)
2. `loadPupilLessonsDetail` layers on:
   - `readUnitsAction`
   - `readLearningObjectivesByUnitAction` per unit (`U` calls)
   - `listLessonActivitiesAction` per lesson (another `L` calls)
3. These actions each open their own Supabase client connection, so we spend significant time in network overhead before transforming anything in Node.

## Proposed approach
1. **Design a `pupil_lessons_bootstrap(p_target_user_id uuid)` RPC**
   - SQL view/CTE that returns JSON per pupil containing:
     - pupil identity & group list
     - grouped lessons with start dates + group metadata
     - unique lessons/units required for homework + history tabs
   - Use lateral joins to pull lesson rows, group subjects, and membership in one pass.
   - **Confirmed scope:** only pupil-level filtering is required. Pass the selected pupil ID for `/pupil-lessons/[pupilId]`; teachers can fetch everyone by passing `NULL`.
   - Teacher landing (`/pupil-lessons`) will keep/receive a lighter-weight RPC focused on summary listings so we don’t ship the heavy detail payload for every pupil.
2. **Extend the RPC to embed dependent blobs**
   - Attach unit metadata + objectives via nested `jsonb_agg` to eliminate `readUnitsAction` + `readLearningObjectivesByUnitAction`. Only include units that have at least one lesson assignment for the pupil so we avoid shipping unrelated curriculum data.
   - Limit lesson history aggregation to the current week (inclusive) and all past weeks—the future modifiers present in the existing detail view should stay filtered out server-side.
   - Attach homework activities filtered with `is_homework = true`, grouped per lesson to replace `listLessonActivitiesAction`. Lesson-detail activity metadata (MCQ/upload configs) will continue to be queried separately so this RPC can stay focused on the overview data.
3. **Add server action wrappers**
   - Implement `readPupilLessonsBootstrapAction` in `src/lib/server-actions/pupil-lessons.ts` calling the new RPC. Wrap the call with `withTelemetry` (logging params/duration there); no extra telemetry needs to run inside the database function itself.
   - Re-export via `src/lib/server-updates.ts`.
4. **Refactor data loaders**
   - Update `loadPupilLessonsSummaries`/`loadPupilLessonsDetail` to call the single bootstrap action, perform only minimal TypeScript-side shaping (sorting, fallback labels).
   - Remove the fan-out calls; rely entirely on the JSON shape from the RPC.
5. **Type & schema alignment**
   - Add/adjust Zod schemas (likely in `src/types/index.ts` or a new module) to validate the single JSON document returned by the RPC. The Next.js server loader (not the client) should split that document into the existing `summary`, `homework`, `weeks`, and `units` segments before serialisation.
   - Ensure the JSON structure surfaces the same optionality defaults (null dates, missing subjects) currently handled in TS so that no raw DB data leaks to the browser.
6. **Migration + documentation**
   - Create a Supabase migration that defines the RPC and any helper SQL (materialized view or function) under `supabase/migrations/*`.
   - Document the RPC purpose, expected shape, and roll-out plan in `AGENTS.md` planner section.

## Open questions / follow-ups
- Do we need pagination/limit controls for teacher view to avoid massive JSON payloads? (Possible future enhancement: accept `group_id[]` or `search` filters, but not required for the initial pupil-only filtering.)
- Should telemetry log the downstream DB time (maybe expose from RPC via `EXPLAIN ANALYZE` later)?
- How do we keep activity uploads in sync—do we need to revalidate caches when new homework activities arrive?
