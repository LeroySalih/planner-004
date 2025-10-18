# Report Level Calculation – Implementation Plan

## 1. Define Level Boundaries
- Translate `specs/calc-levels.md` into a structured data map keyed by pupil year with ordered score thresholds. Capture the table in a dedicated helper (e.g. `src/lib/levels/boundaries.ts`) so future adjustments stay centralized.
- Add type guards and validation to ensure every boundary row is sorted ascending and each level id is unique; fail fast if the config drifts from the spec.
- Export a utility function (`getLevelForScore({ year, percentage })`) that walks the appropriate year column and returns the highest matching level code, defaulting to the lowest band when no threshold is met.

## 2. Integrate Level Calculations
- Update server-side reporting code (`src/app/reports/[pupilId]/report-data.ts`, any assignment/unit summaries) to call the new helper whenever an activities or assessment average is resolved.
- Ensure domain actions return both the raw percentages and the derived level so client components can render consistent badges.
- Thread the level helper through existing calculation pipelines without duplicating the boundary logic; prefer injecting the helper into existing aggregation steps.

## 3. Surface Levels in the UI
- In pupil reports and assignment dashboards, display the calculated level alongside the percentage (e.g. “Activities: 62% • Level 4L”). Provide fallbacks (e.g. “Level pending”) when averages are null.
- Review any CSV/PDF exports or summary cards to include the new level field in a concise format.
- Keep the level label formatting consistent with the spec (uppercase code with suffix).

## 4. Testing & Validation
- Add lightweight unit tests around `getLevelForScore` covering boundary edges (exact threshold matches, below-first-band, highest band).
- Extend existing report integration tests or add manual QA scripts confirming the helper returns the expected levels for sample Year 7–11 scores (e.g. 45% → 3M for Year 8).
- Verify performance by running the pupil report flow for a representative cohort to ensure the additional lookups don’t introduce noticeable latency.

## 5. Documentation & Follow-up
- Mention the new helper and usage guidelines in `specs/calc-levels.md` and the Planner Playbook so future contributors know where to adjust boundaries.
- Outline a maintenance checklist (e.g. when academic standards change) describing how to update the boundary table and regression tests.
- Capture any outstanding questions (e.g. handling years outside 7–11 or null year data) for product clarification before rollout.
