# Plan: `/reports` telemetry instrumentation

## Current telemetry gaps
- Server data loaders such as `getPreparedReportData`, `loadUnitLessonContext`, and the reports landing page fetches run without any timing/trace information.
- There is no shared helper under `src/lib` for emitting telemetry logs, so any per-route instrumentation would be ad hoc.
- The `/reports` landing page loops through groups and pupils without logging path-specific performance, making it hard to diagnose slow group fetches.
- Telemetry guards (`TELEM_ENABLED`, `TELEM_PATH`) and log file writing are currently undeclared; they need central plumbing before route-specific hooks can use them.

## Proposed steps
1. **Introduce telemetry helper** – create a utility (e.g. `src/lib/telemetry.ts`) that checks `TELEM_ENABLED`/`TELEM_PATH`, captures start/end timestamps, and appends structured JSON lines to `logs/telem_<timestamp>.log`, rotating per process start.
2. **Instrument shared report loaders** – wrap `getPreparedReportData`, `getPreparedUnitReport`, and `loadUnitLessonContext` (plus any supporting server functions in the reports route) with the helper so function names, params, auth timings (when available), and durations are captured.
3. **Telemetry in landing page** – apply the helper around the `/reports/page.tsx` data fetching sequence (group list, per-group membership hydration) to surface slow Supabase calls.
4. **Ensure dependencies stay scoped** – only touch files consumed by `/reports` (pages, report data modules, and any reused helper exported specifically for reports) to meet the scope requirement.

## Validation
- Manual: set `TELEM_ENABLED=true` and `TELEM_PATH=reports`, trigger `/reports` and `/reports/[pupilId]`, confirm log lines land in `logs/telem_<timestamp>.log` with accurate durations.
- Runtime: disable telemetry and ensure no log file is created, guarding against unnecessary IO.

## Open questions
- None – auth timing will be captured by wrapping the relevant call sites with dedicated start/end timers before invoking the loader functions.
