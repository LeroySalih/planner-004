# Plan: Pupil Sign-In Tracking

1. **Schema & migration** – Extend `supabase/schema.sql` with the `pupil_sign_in_history` table (pupil_id, url, signed_in_at, uuid primary key) and add a new SQL migration in `supabase/migrations-001` that creates this table so PG stays in sync.
2. **Types** – Introduce `PupilSignInHistorySchema`/`PupilSignInHistoriesSchema` in `src/types/index.ts` so the server helpers can validate rows.
3. **PG helper & auth utilities** – Build a PG-backed helper (`logPupilSignIn`) under `src/lib/server-actions` that wraps the insert in `withTelemetry`, uses `query` from `src/lib/db.ts`, and reexport it via `src/lib/server-updates.ts`; extend `src/lib/auth.ts` with a helper to resolve a session cookie string so middleware can reuse the existing validation logic.
4. **Middleware wiring** – Create `middleware.ts` that runs for all page requests, filters to `GET` + HTML (skip `/_next`, `/api`, static assets), reads the `planner_session` cookie, skips teachers, and calls `logPupilSignIn` with `request.nextUrl.href` and the timestamp.
5. **Verification notes** – Document manual verification (run the app, visit a page while signed in as a pupil, inspect `pupil_sign_in_history` via SQL) so the user can confirm telemetry and data flow; note that the helper already uses the pg client, so no Supabase APIs remain involved.
