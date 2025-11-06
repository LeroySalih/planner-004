# Plan: `/units` & `/lessons` telemetry rollout

## Objectives
- Wrap every server-side fetch executed by `/units`, `/units/[unitId]`, `/lessons`, and `/lessons/[lessonId]` in `withTelemetry` so timings and params flow into the existing TELEM log pipeline.
- Ensure shared loaders leveraged by these routes (units, lessons, subjects, assignments, groups, files, learning objectives, activities, curricula, assessment objectives) emit consistent telemetry without duplicating wrappers at call sites.
- Capture auth timing (where applicable) before invoking data loaders so route-level telemetry exposes `authEndTime`.

## Scope & Targets
- **Routes**: `src/app/units/page.tsx`, `src/app/units/[unitId]/page.tsx`, `src/app/lessons/page.tsx`, `src/app/lessons/[lessonId]/page.tsx`.
- **Shared loaders**: `readUnitsAction`, `readUnitAction`, `readSubjectsAction`, `readAssignmentsAction`, `readGroupsAction`, `readLearningObjectivesByUnitAction`, `readLessonsByUnitAction`, `listUnitFilesAction`, `readLessonsAction`, `readLessonAction`, `readAllLearningObjectivesAction`, `readCurriculaAction`, `readAssessmentObjectivesAction`, `listLessonFilesAction`, `listLessonActivitiesAction`.
- **Telemetry helper**: reuse `withTelemetry` from `src/lib/telemetry.ts`; augment only if new metadata is required (e.g. route tags).

## Implementation Steps
1. **Route instrumentation**
   - Import `performance` and `withTelemetry` into each target page.
   - After enforcing auth (if present), capture `authEnd` and wrap every downstream server action call in `withTelemetry`, bundling parameters and aligning `routeTag` (`/units`, `/units/[unitId]`, `/lessons`, `/lessons/[lessonId]`).
   - Where `Promise.all` is used, maintain concurrency but wrap individual promises with telemetry helpers (e.g. `withTelemetry(..., () => readUnitsAction())`).
2. **Shared loader instrumentation**
   - For each listed loader, wrap the main Supabase interaction with `withTelemetry` (respecting existing return shapes) to avoid multiple route wrappers.
   - Add optional `authEndTime` parameters where upstream routes provide them; default to `null` otherwise.
   - Ensure any nested helper (e.g. `enrichLessonsWithSuccessCriteria`) is instrumented if it performs additional Supabase I/O not already traced.
3. **Propagate route tags**
   - Align `routeTag` strings with telemetry spec (`TELEM_PATH` filtering): use `"/units"` for index work, `"/units/[unitId]"` for detail, `"/lessons"` and `"/lessons/[lessonId]"` respectively.
   - For shared loaders, reuse meaningful tags (`"/units:readUnits"`, `"/lessons:readLesson"`) so logs stay filterable.
4. **Validate typings & concurrency**
   - Adjust TypeScript signatures to pass through `authEndTime` without widening return types.
   - Confirm `Promise.all` wrappers still resolve to `{ data, error }` envelopes expected by the pages.
5. **Telemetry smoke check**
   - Toggle `TELEM_ENABLED=true` and hit each route locally, verifying log entries for every wrapped call.
   - Re-run with telemetry disabled to confirm no extraneous logging occurs.

## Risks & Open Questions
- Some server actions may already call `withTelemetry`; avoid double-wrapping by auditing before changes.
- `requireTeacherProfile` is currently absent from `/lessons` pages; decide whether to introduce it for auth timing or set `authEndTime` to `null`.
- Bulk wrapping of Supabase calls might necessitate minor refactors in complex loaders (e.g. loops with multiple fetches); profile to keep readability high.
