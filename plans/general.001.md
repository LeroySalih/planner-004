# Plan: Reduce Auth & DB Round Trips for /assignments

## Goal
Cut redundant `requireTeacherProfile()` calls and move `/assignments` data shaping into the database so the page hydrates with minimal Supabase queries.

## Step Breakdown
1. **Map Current Calls**
   - Instrument `src/app/assignments/page.tsx` and `src/lib/server-actions` to log where `requireTeacherProfile()` runs.
   - Document which server actions invoke the guard implicitly so we know where we can accept a pre-fetched profile.

2. **Share Auth Context**
   - Update `requireTeacherProfile()` to return the profile data needed downstream (already exposes `{ userId, isTeacher }`).
   - Thread that profile into server actions that currently call the guard again (e.g. `readLessonAssignmentScoreSummariesAction`) via an optional parameter.
   - Within those actions, skip the extra guard when a trusted profile is provided; fall back to the existing call otherwise.

3. **Design Combined Assignments Payload**
   - Model a Supabase RPC (e.g. `rpc('assignments_bootstrap')`) or view that joins groups, subjects, assignments, units, lessons (with objectives/success criteria), lesson assignments, and distinct `{ groupId, lessonId }` pairs.
   - Ensure the SQL handles filtering (active-only), ordering, and deduplication so the server action receives ready-to-render JSON.
   - Extend `supabase/migrations` with the function definition plus any helper views.

4. **Shift Lesson Score Aggregation to SQL**
   - Prototype a Postgres function that accepts an array of `{ group_id, lesson_id }` records and returns the `LessonAssignmentScoreSummaries` payload by performing the membership, activity, and submissions joins inside SQL.
   - Include chunking logic in SQL (CTEs + lateral joins) so the RPC runs efficiently without client-side batching.

5. **Implement New Server Actions**
   - Replace the multiple sequential reads in `src/app/assignments/page.tsx` with two server calls:
     1. `readAssignmentsBootstrapAction` → single RPC for all base data.
     2. `readLessonAssignmentScoreSummariesAction` → updated to call the new SQL function and accept an injected teacher profile.
   - Ensure both actions are wrapped with `withTelemetry`.

6. **Update Page + Components**
   - Adjust `AssignmentManager` props to consume the combined payload shape.
   - Remove now-unused client-side derivations (e.g. `summaryPairs` if returned directly from the RPC).
   - Confirm error boundaries still surface per-section failures gracefully.

7. **Testing & Verification**
   - Smoke-test `/assignments` with seeded data to confirm identical UI output.
   - Measure the number of Supabase queries (using logs/telemetry) before vs. after the change to verify reductions.
   - Document the new workflow in `AGENTS.md` and `specs/assignments/general.000.md` if additional guidance emerges during implementation.

