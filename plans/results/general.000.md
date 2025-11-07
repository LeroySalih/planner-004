# Plan: Cached Results Pipeline for /reports

## Overview
Prototype an end-to-end pipeline where feedback writes in `/results/assignments` trigger async transactional calculations that populate cached report tables. Keep the existing instant-return + optimistic UI path intact while layering the new background work.

## Step Breakdown
1. **DB schema + migrations**
   - Draft per-student derived tables (e.g. `report_student_rollups`) so `/reports/{pupilId}` reads a single row and `/reports/groups/{groupId}` can aggregate across those rows. Key rows for quick lookups by student, cohort, and timeframe.
   - Capture staging SQL under `supabase/migrations/<timestamp>_reports_cached_tables.sql`, including:
     - Table DDL with indexes for report filters.
     - Stored procedures (or SQL functions) that accept the minimum input needed to recalc affected rows and wrap their mutations inside explicit transactions.
     - A one-time backfill routine that hydrates the cached tables using existing feedback data so `/reports` works immediately after deployment.

2. **Server action orchestration**
   - Augment the feedback write action (likely under `src/lib/server-actions/feedback.ts` or adjacent) to:
     - Keep the immediate Supabase upsert + optimistic response path unchanged.
     - After responding, enqueue async work (e.g. `queueReportRecalc({ assignmentId, studentId })`).
   - Implement `queueReportRecalc` under `src/lib/server-actions/reports.ts` that:
     - Uses Supabase RPC endpoints or `rest/v1/rpc` to call the transactional procedures created above.
     - Fire-and-forget the async recalculation so the initial response stays instant.
     - Restricts recalculation to the affected pupil to keep work bounded.
     - Emits structured telemetry (wrap with `withTelemetry`).
     - Logs success/failure for observability and retries on transient errors.

3. **Realtime + optimistic UI**
   - Ensure `/results/assignments` client components still broadcast updates through Supabase Realtime channels so peers sync quickly.
   - Optionally subscribe `/reports` view to cached-table channels to refresh when async calculations finish (Phase 2 stretch goal, document in TODO).

4. **Reports data fetching**
   - Update `/reports` page server loader(s) to read directly from cached tables via server actions, guaranteeing consistent shape for UI components.
   - Reuse existing Zod schemas or extend `src/types/index.ts` to describe the cached table rows; pipe these through the action responses.

5. **Testing + docs**
   - Add Playwright (or manual) scenarios covering feedback submission and verifying that cached rows change (can use Supabase dashboard/log output as proxy for now).
   - Extend `AGENTS.md` or feature docs with the new workflow once prototype stabilizes.

## Notes / Constraints
- All multi-table updates must occur through explicit transactional procedures invoked via the Supabase API; do not rely on triggers.
- Keep migrations idempotent and reversible within Supabase tooling.
- Telemetry logging must respect `TELEM_ENABLED`/`TELEM_PATH` and emit to `logs/telem_<TIMESTAMP>.log`.
- Coordinate background job execution with existing async patterns (e.g. queue helper in `src/lib/server-updates.ts`) to avoid ad-hoc `setTimeout` usage.
