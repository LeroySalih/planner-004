# Plan: Replace Supabase Auth with Internal Password Auth

## Goal
Remove Supabase as the authentication provider while keeping the existing `profiles.user_id` as the canonical user identifier. Introduce a password hash field (defaulting to the hash of `bisak123`), replace Supabase session handling with a homegrown flow, and let teachers reset password hashes from the Groups area.

## Decisions (per user)
- Password hashing: bcrypt, cost factor 10 (consistent across prod and local).
- Login identifier: email; `user_id` remains the canonical foreign-key identifier.
- Session policy: 30-day TTL with rolling refresh on activity; no separate idle timeout.

## Step Breakdown
1. **Audit Current Auth Surface**
   - Map every Supabase auth dependency (`supabase.auth.*`, `createSupabaseServerClient`, `supabaseBrowserClient`) across server actions, route guards (`src/lib/auth.ts`), and signin/signup components.
   - Document where RLS/session context is assumed so replacement hooks can re-apply authorization without Supabase JWTs.

2. **Schema Updates**
   - Add `password_hash text not null default '<bcrypt-of-bisak123>'` (or equivalent) to `profiles` via a new migration under `supabase/migrations`; backfill existing rows.
   - Store login email on `profiles` with a case-insensitive unique index so sign-in can rely solely on planner tables (no Supabase auth.users dependency).
   - Introduce an `auth_sessions` (or similar) table with `session_id`, `user_id`, `hashed_token`, `created_at`, `expires_at`, `ip`, and `user_agent` to support cookie-based sessions.
   - Update Zod schemas/types in `src/types/index.ts` to include `password_hash` and any new session shapes.

3. **Homegrown Auth Service**
   - Build a password hashing/verification helper (e.g., bcrypt/argon2) and a token generator for session cookies; keep secrets in env vars.
   - Replace Supabase-based helpers in `src/lib/auth.ts` with functions that:
     - Validate credentials against `profiles.email` (or username) + `password_hash`.
     - Issue and persist session records, set/clear httpOnly, secure cookies.
     - Load the current profile from the session cookie and enforce teacher-only routes.
   - Ensure telemetry wraps all auth operations per `withTelemetry`, capturing timings and route tags.

4. **Rewrite Signin/Signup Flows**
   - Update `SigninForm` and `SignupForm` to call new server actions (no direct Supabase browser client) using `useActionState` for loaders/toasts.
   - Adapt signup to insert into `profiles` with hashed password and default teacher flag when appropriate; block duplicate emails.
   - Provide sign-out action to drop the session cookie and DB record.

5. **Propagate Auth Context to Server Actions/Pages**
   - Refactor existing server actions to accept a trusted `AuthenticatedProfile` from the new auth helper instead of `supabase.auth.getUser()`.
   - Adjust Supabase data access to use the service client (or pg driver) plus manual authorization checks based on the session profile.
   - Update route handlers and layouts (e.g., `/assignments`, `/groups`, `/pupil-lessons`) to rely on the new auth guard and remove Supabase cookie wiring.

6. **Groups Page Password Reset**
   - Add a server action exposed in `src/lib/server-actions/groups.ts` to reset a member’s `password_hash` (default to hashed `bisak123`), gated to teachers.
   - Extend Groups UI to trigger the reset (e.g., from member list or group detail) with optimistic UI, loader state, and toast feedback.
   - Log telemetry for resets and ensure auditability (who triggered the reset and for which `user_id`).

7. **Clean-Up & Config**
   - Remove unused Supabase auth env vars and client usage; keep Supabase DB access only where needed.
   - Update docs (`AGENTS.md`/playbook) to describe the new auth model, session cookies, defaults, and reset flow.
   - Add seeds/fixtures for default hashed passwords to keep Playwright specs working.

8. **Verification**
   - Manual pass: signup → signin → navigate teacher-only pages → signout; verify session cookie lifecycle.
   - Regression checks on pages previously using Supabase session (groups, assignments, profile).
   - Validate the groups password reset end-to-end and confirm hashes change in DB.
