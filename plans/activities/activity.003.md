# Activity Summative Flag Plan (v3)

> Requirement: Specs now call for an editable `is_summative` flag on activities. Reuse the existing activity store/state so this metadata flows through all surfaces. `is_homework` already exists—no changes required for that field.

## 1. Data Contracts & Schema
- Validate that Supabase `activities` already exposes `is_summative boolean default false`; no migration should be needed, but call it out in deployment notes if any environment lags.
- Update canonical Zod schemas in `src/types/index.ts` (e.g. `LessonActivitySchema`, `LessonActivitiesSchema`, `AssignmentResultActivitySchema`, any submission/result types) to normalise `is_summative` to `false` when missing so inferred types expose a reliable boolean.
- Refresh any derived TypeScript types consumed by client components or server actions, ensuring there are no stale `any` casts around the new property.

## 2. Server Actions & Store Plumbing
- Extend `CreateActivityInputSchema`/`UpdateActivityInputSchema` in `src/lib/server-actions/lesson-activities.ts` to accept an `isSummative` boolean, writing through to `activities.is_summative`.
- Make sure list/read helpers (`listLessonActivitiesAction`, pupil lesson data loaders, assignment result fetchers) include the flag so the React activity store remains authoritative.
- Review the store initialisation in components such as `LessonActivitiesManager` to confirm `setActivities` carries `is_summative` alongside other metadata and that optimistic updates keep it in sync.

## 3. UI & Interaction Updates
- Implement the summative toggle called out in the spec's short activity view: add a switch component bound to the activity store, showing the current `is_summative` state and allowing teachers to update it.
- If other teacher-facing editors (e.g. main activity manager sheet) should expose the flag, mirror the homework toggle pattern with optimistic updates and loading feedback.
- Audit pupil- and results-facing views to decide how summative activities should be surfaced (badges, filters, score weighting visuals) without regressing existing behaviour.

## 4. QA, Docs & Rollout
- Add tests around create/update server actions to cover summative flag persistence plus an end-to-end toggle scenario (Playwright or integration).
- Update seed data / fixtures if needed so at least one activity starts with `is_summative = true` for UI verification.
- Document the new control in `specs/activities.md` and the Planner Playbook, noting that the store now carries both `is_homework` and `is_summative`. Include deployment notes confirming schema parity across environments.

