# Plan: Comma-separated `TELEM_PATH`

## Objectives
- Allow the telemetry helper to treat `TELEM_PATH` as a comma-separated list so multiple prefixes (e.g. `units,lessons`) enable tracing at once.
- Maintain backwards compatibility when the variable is unset or holds a single value.
- Update any helper utilities/tests that parse `TELEM_PATH` to handle whitespace and casing consistently.

## Key Tasks
1. **Audit current parsing**  
   - Review `src/lib/telemetry.ts` (and any related helpers) to see how `TELEM_PATH` is read today.  
   - Note whether matching is prefix-based, exact, or uses regex.
2. **Implement multi-path parsing**  
   - Convert the environment value into an array by splitting on commas, trimming whitespace, and discarding empty segments.  
   - Update matching logic to check the current span’s `routeTag` against every configured prefix (case-insensitive if current behavior expects it).
3. **Refine logging metadata**  
   - Ensure the log output still includes a single `routeTag`, but add debugging messages when filtering skips a tag to aid troubleshooting.
4. **Validation & docs**  
   - Add/adjust unit-level smoke test or dev snippet if telemetry has automated coverage; otherwise document manual steps (set `TELEM_PATH=units,lessons` and hit both pages).  
   - Confirm no other consumers rely on the previous single-string assumption.

## Risks & Mitigations
- **Whitespace/blank entries** – trim each segment and filter empty strings to avoid accidental all-matches.  
- **Performance** – small arrays should not be an issue; keep matching cheap by precomputing the parsed list once.
