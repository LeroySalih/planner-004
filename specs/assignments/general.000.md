# Assignments – Specifications

## Data Loading & Performance
- The `/assignments` route must minimise Supabase round trips by grouping related reads (groups, subjects, assignments, units, lessons, lesson assignments, and any score summaries) into shared SQL views or RPCs.
- Prefer server-side aggregation so the page can hydrate from as few server actions as possible; JSON payloads returned from the database should already contain the derived data needed for rendering.
- Any new feature on this route must include a plan for how its data piggybacks on existing grouped calls before adding a standalone query.
- `assignments_bootstrap()` (exposed via `readAssignmentsBootstrapAction`) is the canonical source for `/assignments` base data; extend that RPC when new fields are required rather than issuing new selects.
- Lesson score cards must call the `lesson_assignment_score_summaries()` RPC (via `readLessonAssignmentScoreSummariesAction`) so membership, activity, and submission joins stay inside the database.
