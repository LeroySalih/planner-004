# Planner App Constitution

## Core Principles

### I. Schema-First Domain Contracts
Every domain change starts by extending or reusing the Zod schemas in `src/types/index.ts`. Server actions and UI layers must consume the inferred types, continue returning `{ data, error }` envelopes, and keep Supabase migrations and seed data in sync so shared contracts never drift.

### II. Secure Server Actions & Auth Guards
Server components, route handlers, and mutations use `createSupabaseServerClient()` alongside `requireAuthenticatedProfile()` / `requireTeacherProfile()` to gate data access. All side effects live in server action modules and are re-exported through `src/lib/server-updates.ts` for a single source of entry.

### III. Shared UI Composition
Compose UI with Next.js App Router server/client components, the Radix-backed primitives in `src/components/ui`, and feature bundles like the Assignment Manager. Styling flows through Tailwind v4 tokens and `cn()` to preserve consistent theming and dark-mode behaviour.

### IV. Defensive Error & State Handling
Validate every payload with Zod before touching Supabase, surface safe error strings, and log actionable context. Client updates should mirror the Assignment Manager pattern: optimistic transitions via `useTransition`, state snapshots for rollbacks, and `sonner` toasts for user feedback.

### V. Testing, Migrations, and Tooling Discipline
User-visible changes ship with Playwright coverage stored under `tests/`. Database shifts originate from `npm run db:diff` and land in `supabase/migrations` with seeds refreshed via `bin/dev_db_sync.sh`. Keep npm scripts the source of truth for dev/build flows and avoid ad-hoc tooling.

## Implementation Constraints

- Stack: Next.js 15 App Router with React 19, TypeScript everywhere, Tailwind CSS v4, Radix UI primitives, and Supabase for auth, database, and storage.
- Data Access: Server-side code uses `src/lib/supabase/server.ts`; browser code relies on `src/lib/supabase-browser.ts` to guarantee consistent configuration.
- Utilities: Reuse helpers in `src/lib` (`auth.ts`, `utils.ts`, `levels/index.ts`) before introducing new abstractions.
- Styling: New classes must align with `src/app/globals.css` tokens; prefer composable components over bespoke markup.
- Documentation: Extend the Planner Agents Playbook when introducing workflows, scripts, or testing utilities.

## Workflow & Review Process

1. Confirm the necessary Zod schema or add it in `src/types/index.ts` before UI or Supabase work.
2. Implement or adapt server actions under `src/lib/server-actions/*`, re-export them in `src/lib/server-updates.ts`, and protect them with the proper auth guard.
3. Build or extend UI using shared primitives, documenting complex logic with succinct comments when clarity demands it.
4. Wire optimistic and error handling following established patterns, ensuring Supabase responses are wrapped safely.
5. Update Supabase migrations and seeds in lockstep, then cover the change with Playwright specs when it affects user behaviour.
6. Append relevant notes to this constitution or the Planner Agents Playbook whenever workflows evolve.

## Governance
This constitution supersedes conflicting guidance for Spec Kit usage in the Planner app. Amendments require maintainer approval, documentation in the Planner Agents Playbook, and a version bump recorded below.

**Version**: 1.0.0 | **Ratified**: 2025-10-31 | **Last Amended**: 2025-10-31
