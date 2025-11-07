# /reports Data Read Consolidation Plan

## 1. Objective & Success Criteria
- Reduce `/reports` landing page data loading to a single database round-trip that already includes pupil roster + group memberships.
- Maintain existing telemetry (`withTelemetry` on `listPupilsWithGroupsAction`) and auth guards without adding extra Supabase calls.
- Ensure the returned payload stays compatible with `ReportsTable` (pupil id, display name, sorted group ids) so the UI remains server-rendered with no behavioural regressions.

## 2. Postgres Function & Schema Work
- Create a Supabase migration that defines a SQL function (e.g., `rpc_pupils_with_groups(route_tag text)`) which:
  - Filters `profiles` to non-teachers, trims names, and guards against nulls.
  - LEFT JOINs `group_membership` and `groups` to pull `group_id` plus `subject`, limited to `role = 'pupil'`.
  - Aggregates each pupil’s memberships into a sorted JSON array and emits a final JSON object `{ pupil_id, pupil_name, groups: [{ group_id, group_name }] }`.
- The function should handle empty memberships, dedupe group ids, and perform locale-aware ordering via SQL (e.g., `ORDER BY lower(group_name), group_id`).
- Update `src/types/index.ts` (if needed) with a schema describing the JSON shape returned by the function so server actions can validate it.

## 3. Supabase Client Integration
- In `listPupilsWithGroupsAction`, replace the two-table selects with a single `supabase.rpc("pupils_with_groups")` call.
- Parse the JSON using the existing/new Zod schema, log and return an empty array on failure, and keep telemetry instrumentation untouched.
- Remove in-memory aggregation logic once the RPC result already provides sorted groups.

## 4. Telemetry & Logging
- Pass through the current `routeTag`/`functionName` when calling `withTelemetry`; include RPC timing in logs so TELEM output continues to show `/reports` performance.
- Add concise server-side logs when the RPC returns malformed JSON or empty data to aid debugging without reintroducing multiple queries.

## 5. Testing & Documentation
- Validate the new function locally by seeding representative pupils/groups and confirming the RPC output matches today’s `reports` UI expectations.
- Because `/reports` currently lacks automated tests, add at least a smoke Playwright spec (future work tracked separately) to load the page and verify the roster renders.
- Update `specs/reports/general.000.md` (done) and note the single-call requirement plus RPC details in `AGENTS.md` or a dedicated Supabase appendix so future agents follow the same pattern.
