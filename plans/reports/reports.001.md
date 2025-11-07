# Plan: Streamlined Report Cache Payloads

## Problem Statement
The current cache stores the entire `reports_get_prepared_report_dataset` output as a JSON blob per pupil. Fetching and parsing that heavy JSON in Next.js causes higher CPU and latency than the previous on-demand SQL joins, especially when `/reports` only needs a subset of the data.

## Objectives
1. Reduce payload size and parsing overhead for `/reports` and `/reports/groups/[groupId]` without regressing freshness.
2. Keep cache writes transactional and observable (no triggers), but move the expensive recomputation off the critical request path.

## Proposed Approach
1. **Schema redesign**
   - Introduce normalized cache tables (e.g., `report_pupil_summary`, `report_pupil_unit_metrics`) that persist only the fields required for the reports UI. Avoid nested JSON; store primitive columns (averages, working levels, related group ids) for direct SELECTs.
   - Maintain the existing `report_pupil_feedback_cache` for fast success-criteria lookups, but consider narrower columns (INT2 ratings, partial indexes) to trim storage.

2. **Migration + backfill**
   - Create a Supabase migration that:
     - Adds the new normalized tables with appropriate indexes (per pupil and per group filter combos).
     - Introduces a refreshed `reports_recalculate_pupil_cache` procedure that writes both the normalized rows and, optionally, a slim JSON summary for pages that still need nested structures.
     - Backfills the tables by iterating pupils with existing cache rows to avoid cold misses.

3. **Server action refactor**
   - Update the report data loaders to query the normalized tables via standard `.from()` selects instead of fetching `dataset` JSON. Reconstruct any nested structures in TypeScript only from the needed columns.
   - Keep a fallback path to the RPC in case a cache row is missing, but ensure the fallback writes the normalized rows so future requests are fast.

4. **Async recompute workflow**
   - Ensure `schedulePupilReportRecalc` (and any future background worker) only recomputes the normalized tables, and log duration/row counts via telemetry for observability.
   - Add optional warming scripts (e.g., `bin/reports_cache_warm.sh`) to precompute pupils ahead of heavy usage periods.

5. **Performance validation**
   - Capture baseline timings (before/after) for `/reports` and `/reports/groups/[groupId]` under a representative dataset using the new cache tables. Store findings in `specs/reports/cache.md` for future reference.

## Risks / Mitigations
- **Migration complexity**: mitigate with clear DDL and staged rollout (populate new tables while old JSON cache still serves requests).
- **Data drift**: reuse the same source function (`reports_get_prepared_report_dataset`) inside the RPC to guarantee consistent calculations.
- **Client regressions**: gate the new loader behind a feature flag or environment variable during rollout for quick rollback if needed.
