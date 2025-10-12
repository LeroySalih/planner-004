# Planner Agents Playbook

This guide captures the working knowledge future coding agents need to extend the planner app confidently. Keep it close whenever you write, refactor, or review code here.

## Stack Snapshot
- Next.js 15 App Router with React 19 server and client components (`src/app/page.tsx`).
- TypeScript throughout; validation expressed with Zod schemas in `src/types/index.ts`.
- Tailwind CSS v4 with Radix UI primitives and shared wrappers under `src/components/ui`.
- Supabase provides auth, database access, and storage. Server and browser clients live in `src/lib/supabase/server.ts` and `src/lib/supabase-browser.ts`.
- Playwright drives end-to-end coverage (`tests/sign-in/teacher-sign-in.spec.ts`).

## Directory Landmarks
- `src/app` – Route handlers, layouts, and feature entrypoints. For example, `src/app/assignments/page.tsx` composes Assignment Manager data on the server.
- `src/components` – Reusable UI and composite widgets. Feature bundles like `src/components/assignment-manager` plug into pages.
- `src/actions` – Ad-hoc server-side helpers that do not yet live in the consolidated action modules.
- `src/lib` – Domain helpers and service clients. Key files: `src/lib/server-updates.ts` (server action barrel), `src/lib/auth.ts` (auth guards), `src/lib/utils.ts` (utility helpers).
- `src/types` – Canonical Zod schemas and inferred types that mirror Supabase tables.
- `supabase` – SQL migrations, schema snapshots, and seed tooling; drive all schema changes through here.
- `tests` – Playwright specs plus `.env.test` fixture configuration.
- `bin` – Shell scripts for Supabase sync and environment loading (e.g. `bin/dev_db_sync.sh`).

## Core Domain & Data Contracts
- Treat Zod schemas in `src/types/index.ts` as the source of truth for planner entities (groups, units, lessons, assignments, feedback). Extend or reuse these instead of recreating ad-hoc shapes.
- Many server actions parse and return `{ data, error }` envelopes validated with these schemas (see `src/lib/server-actions/groups.ts`). When adding APIs, stick to the same pattern for consistency and predictable error handling.
- Assignment-related UI expects `Assignments`, `LessonAssignments`, and `LessonFeedbackSummaries` shaped exactly like the schemas; ensure backend changes keep these contracts intact (`src/components/assignment-manager/assignment-manager.tsx`).

## Supabase & Server Actions
- Use `createSupabaseServerClient()` for server components/actions (`src/lib/supabase/server.ts:1`). It wires cookies for authenticated requests.
- Client-side Supabase usage must import `supabaseBrowserClient` (`src/lib/supabase-browser.ts:1`) to guarantee consistent config.
- All server actions are exported through `src/lib/server-updates.ts:1`; add new domain actions there so pages/components can consume a single barrel.
- Follow the defensive error handling shown in `src/lib/server-actions/feedback.ts:1`—parse input with Zod, wrap Supabase calls, and surface a safe error string.
- Authorization helpers like `requireTeacherProfile()` live in `src/lib/auth.ts:1`; enforce these guards in route handlers before performing teacher-only operations (`src/app/assignments/page.tsx:1`).

## Client/UI Conventions
- Compose UI with the Radix-backed primitives from `src/components/ui` (e.g. `button.tsx:1`, `form.tsx:1`, `dropdown-menu.tsx`). Wire class names through the `cn` helper (`src/lib/utils.ts:1`) to maintain Tailwind merge behaviour.
- Long-form feature components (e.g. `src/components/assignment-manager/assignment-manager.tsx:1`) separate stateful logic and per-pane subcomponents. Mirror this pattern when introducing new management consoles.
- Styling tokens and dark mode variants come from `src/app/globals.css:1`; keep new Tailwind classes aligned with the defined palette.
- Prefer functional components and React hooks. When building forms, wrap them with the shared Form provider to integrate validation and accessible labelling (`src/components/ui/form.tsx:1`).
- Toast notifications rely on `sonner`; reuse the existing pattern from Assignment Manager when showing optimistic updates.

## Testing & Quality
- End-to-end user flows live in Playwright specs (example: `tests/sign-in/teacher-sign-in.spec.ts:1`). Follow the same organization (`tests/<area>/<feature>.spec.ts`) and use environment variables from `tests/.env.test`.
- There are no unit test utilities yet; if you introduce them, document their usage here and wire them into `npm run test`.
- Run `npm run lint` (Next/ESLint) and `npm run test` (Playwright) before surfacing changes. For flaky UI steps, capture traces with `TRACE=1 npm run test`.

## Tooling & Workflows
- Scripts in `package.json` cover the usual dev, build, lint, and test tasks. Database helpers (`db:pull`, `db:push`, `db:diff`) assume Supabase CLI setup.
- Sync Supabase schema for local development via `bin/dev_db_sync.sh`, which chains dump/apply scripts. Seed users live in `supabase/seed.sql` and `supabase/seed-users.mjs`.
- Use `npm run db:diff "migration-name"` to scaffold migrations, commit them under `supabase/migrations`, and refresh generated types if table shapes change.

## Implementation Checklist
1. Confirm the relevant Zod schema exists or add one in `src/types/index.ts` before touching UI or Supabase logic.
2. Expose new server mutations or queries through the `src/lib/server-actions/*` modules and re-export from `src/lib/server-updates.ts`.
3. Guard server routes with `requireAuthenticatedProfile()`/`requireTeacherProfile()` where needed (`src/lib/auth.ts:1`).
4. Build UI using existing primitives, keep indentation at two spaces, and leverage `cn()` for class composition.
5. Wire optimistic updates carefully—use `useTransition` and state snapshots like in the Assignment Manager to keep UI responsive.
6. Update or add Playwright specs covering the user-visible change; store connections to seeded data where possible.
7. Document any new workflows or scripts by appending to this playbook so the next agent inherits the context.

Stay vigilant for unexpected file changes. If Supabase tables or shared types evolve, ripple the updates through server actions, client components, and tests in one pass to avoid drift.
