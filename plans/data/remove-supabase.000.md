# Plan: Remove Supabase Data Access (Keep Storage & Realtime)

## Scope
Replace all Supabase data reads/writes with direct Postgres access (via `src/lib/db.ts`), while preserving Supabase storage and realtime usage. Complete removal will be phased by feature to minimise regressions.

## Order of Execution
1. **Lessons & Submissions**
   - Server actions: `lesson-activities`, `lesson-activity-files`, `lesson-files`, `lesson-links`, `lesson-learning-objectives`, `lesson-success-criteria`, `submissions`, `pupil-lessons`.
   - Replace Supabase reads/writes with PG queries; keep storage upload/download and realtime channels intact.
   - Validate pupil upload, teacher review, success criteria, and lesson detail pages.

2. **Assignments & Results**
   - Server actions: `assignments`, `assignments-bootstrap`, `lesson-assignments`, `assignment-results`, `lesson-assignment-scores`, `short-text`.
   - Swap Supabase data access for PG; preserve realtime result broadcasting.
   - Verify assignment manager, scoring, and result dashboards.

3. **Units & Curriculum**
   - Server actions: `units`, `unit-files` (storage stays), `curricula` (already on PG), `learning-objectives` helper (already on PG).
   - Ensure unit detail, unit file storage, and curriculum pages are consistent.

4. **Feedback & Pupils**
   - Server actions: `feedback`, `pupils`, `lesson-feedback` related paths.
   - Move data access to PG; confirm feedback flows and pupil listings.

5. **Miscellaneous/Prototypes**
   - Server actions: `prototypes/fast-ui`, any remaining Supabase reads.
   - Clean up residual Supabase client imports outside storage/realtime.

6. **Client-Side Supabase Calls**
   - Audit `supabaseBrowserClient` usages; remove all data fetches, keep only storage/realtime channel subscriptions.
   - Ensure navigation/top-bar and lesson pages rely on server actions for data.

7. **Cleanup & Verification**
   - Remove unused Supabase env dependencies for data paths (keep storage/realtime envs).
   - Smoke-test critical flows per feature; adjust telemetry/logging as needed.

## Notes
- Storage (file upload/download) and realtime channels remain Supabase-driven.
- Each feature pass should include a quick manual validation before moving on.
