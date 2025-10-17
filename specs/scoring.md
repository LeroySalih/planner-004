# Scoring Overview


## Change Log
2025-10-17 07:49 Added the concept of total and assessment scores at lesson level.
2025-10-17 07:49 Added the concept of total and assessment scores at unit level.


## Activity Scores
- Each scored activity records values per linked success criterion; missing entries are normalised to `0` before averaging so empty criteria never inflate results (`src/lib/scoring/success-criteria.ts`).
- Submission parsing depends on the activity type. Multiple-choice submissions treat `is_correct` as `1` or `0` and spread any teacher override across all linked criteria, while short-text submissions prioritise `teacher_override_score` ahead of the AI score. Generic activity bodies fall back to the `score`/`override_score` fields (`src/lib/server-actions/assignment-results.ts`).
- The assignment results matrix stores the averaged success-criteria score for each pupil × activity cell (defaulting to the effective auto/override value) so every cell represents a percentage between `0` and `1` (`src/lib/server-actions/assignment-results.ts`).

## Lesson Scores
- `readLessonSubmissionSummariesAction` iterates a lesson’s activities, normalises each submission’s success-criteria map, and averages those per-submission scores to build the per-activity summaries used in lesson feedback views (`src/lib/server-actions/submissions.ts`).
- The action now returns an `averages` payload with `totalAverage` (all scorable activities) and `summativeAverage` (activities where `is_summative = true`, surfaced to users as the *assessment* average). When a `userId` is provided, both averages are recalculated using only that pupil’s submissions.
- Lesson-facing views show both totals: overall and assessment percentages surface in the feedback panel alongside per-activity breakdowns (`src/components/lessons/activity-view/index.tsx`).

## Unit Scores
- Assignment results now surface both totals and assessment averages per activity, success criterion, and for the overall grid (`src/lib/server-actions/assignment-results.ts`, `src/components/assignment-results/assignment-results-dashboard.tsx`).
- Unit-level rollups are derived on demand by walking lesson submission summaries and calculating `totalAverage` / `summativeAverage` (displayed as total vs assessment) together with activity counts.
- Unit dashboards should display both totals so staff can contrast overall progress with assessment-only performance; values are always computed on demand and are not stored in Supabase.
