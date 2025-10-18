# Assignment Grid – Drive Highlights from Lesson Scores

## 1. Map Existing Flow
- Trace how `src/app/assignments/page.tsx` collects lesson assignments and feedback summaries, then how `src/components/assignment-manager/assignment-grid.tsx` maps those summaries into the green/red/grey gradient.
- Confirm whether any downstream consumers (beyond the grid) rely on `lessonFeedbackSummaries`; catalogue anything that would break if we remove or replace that prop.
- Capture the current colour thresholds and tooltip copy so we can decide what should remain once the data source changes.

## 2. Surface Lesson Total Scores Per Assignment
- Choose the data source for “lesson total score” per group/lesson pair (likely the `overallAverages.activitiesAverage` produced by `readAssignmentResultsAction` in `src/lib/server-actions/assignment-results.ts` or a lighter-weight helper built from its internals).
- If an efficient helper doesn’t exist, add a new server action (e.g. `readLessonAssignmentScoreSummariesAction`) that accepts `[{ groupId, lessonId }]` and returns `{ activitiesAverage, assessmentAverage }` for each pair, limiting Supabase reads to the required `activities`, `submissions`, and group membership rows.
- Extend `src/types/index.ts` with a Zod schema describing the new score summary payload so we keep type-safety across server and client code.
- Re-export the new action through `src/lib/server-updates.ts` for client consumption.

## 3. Thread Scores Through Assignment Manager
- Update `src/app/assignments/page.tsx` to request the new score summaries alongside assignments, units, lessons, and lesson assignments (batching requests where sensible to avoid sequential waits).
- Adjust `AssignmentManagerProps` in `src/components/assignment-manager/assignment-manager.tsx` to accept the score summaries, store them in state, and expose quick lookup helpers similar to the existing feedback map.
- Provide a graceful fallback when a score summary is missing (e.g. null average → treat as zero progress) so the UI still renders for lessons without any submissions.

## 4. Rework Grid Styling & Copy
- Refactor the gradient builder in `src/components/assignment-manager/assignment-grid.tsx` so the green portion represents the lesson `activitiesAverage` (0–100%). The red segment should fill the remaining width (`100% - totalScore%`) to visually complement the green slice. Lessons without score data should render a neutral grey background.
- Update tooltip/legend text to reference “Total score” or equivalent wording, dropping the positive/negative feedback copy. Display values as raw percentages from the 0–1 average without additional rounding rules; allow native formatting/precision to pass through.
- Remove the feedback summary dependency from the grid entirely, since the old positive/negative counts are no longer surfaced.

## 5. Clean-up & Validation
- Prune unused server actions (`readLessonFeedbackSummariesAction`) and related client code if the feedback rollup is fully replaced; otherwise, update documentation to clarify where feedback is still applied.
- Smoke-test the assignments page with seeded data: verify lessons with submissions show the expected green coverage, and lessons without data stay grey.
- Consider adding regression coverage (Playwright or unit test) that verifies the gradient width reacts to mocked score summaries.

## Open Questions
- None at this time.
