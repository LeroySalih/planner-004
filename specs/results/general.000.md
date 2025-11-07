# Results: Feedback Write + Reports Cache Prototype

## Goal
Prototype an improved pattern for persisting feedback data written via `/results/assignments` so that the `/reports` route can render from pre-computed calculation tables instead of recomputing metrics on demand.

## Requirements
1. Preserve the current UX already proven in unit/lesson editing flows:
   - Server action returns immediately after the basic Supabase write.
   - Client performs optimistic updates and keeps buttons interactive.
   - Browser members subscribe via Supabase Realtime to reconcile the eventual authoritative state.
2. Extend the feedback write flow so that, after the immediate response, the server fire-and-forget queues async transactional work that recalculates and stores cached report data for the affected pupil only.
3. Introduce derived calculation tables dedicated to powering `/reports`, aggregated per student so `/reports/{pupilId}` can render directly from precomputed unit summaries (`report_pupil_unit_summaries`) while `/reports/groups/{groupId}` derives cohort views from those rows. Provide a migration-time backfill that seeds these tables from existing feedback scores so the prototype works immediately on current data.
4. Write the async calculations as explicit transactional procedures/operators inside the database layer (no triggers) so success/failure stays observable. All access from Next.js must go through the Supabase API/SDK.
5. Ensure telemetry hooks wrap the new server pathway to capture function names, params, and timing deltas, gated by `TELEM_ENABLED` and `TELEM_PATH`.
6. Document the workflow inside this specs file and cross-reference in future planner updates.

## Open Questions / Validation Targets
- Exact schema for cached report tables (assignments vs aggregate per cohort).
- Scope of recalculations per write (per assignment, per class, per student) to keep async job bounded.
- How to surface async failures to monitoring/ops.
- Whether cached tables require backfill scripts for existing data.
