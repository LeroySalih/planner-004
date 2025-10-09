# Repository Guidelines

## Project Structure & Module Organization
- `src/app` holds Next.js routes, layouts, and server components for planner flows.
- `src/components` and `src/hooks` expose reusable UI primitives built on Radix and Tailwind.
- `src/lib` centralizes domain helpers (Supabase clients, search utilities, server actions); keep cross-cutting logic here.
- `supabase` stores SQL migrations, seed scripts, and local schema snapshots; run changes through this folder.
- `tests` contains Playwright specs (`*.spec.ts`); `tests-examples` offers reference scenarios; `test-results` captures Playwright output.
- `public` hosts static assets used by the app shell and marketing surfaces.

## Build, Test, and Development Commands
- `npm run dev` — start the Turbopack dev server at `http://localhost:3000`.
- `npm run build` / `npm run start` — produce and serve the optimized Next.js build.
- `npm run lint` — apply the root ESLint config (`eslint.config.mjs`) to TypeScript, React, and Tailwind usage.
- `npm run test` — execute Playwright end-to-end suites; use `TRACE=1` to gather traces when troubleshooting.
- `npm run db:reset` — rebuild the Supabase database, export fresh seed data, and load default users.

## Coding Style & Naming Conventions
- Use TypeScript everywhere; default to 2-space indentation and named exports for shared modules.
- Favor functional React components; colocate client/server components under `src/app` and mark server actions in `src/actions`.
- Compose class names with the `cn` helper (`src/lib/utils.ts`); align Tailwind tokens with the existing design scale.
- Run `npm run lint` before opening a PR to enforce ESLint and accessibility rules.

## Testing Guidelines
- Write Playwright specs under `tests/<area>/<feature>.spec.ts` with descriptive `test` titles covering core user journeys.
- Keep scenarios idempotent: rely on fixtures in `supabase/seed.sql` or create/reset data through documented server actions.
- Capture screenshots or traces (`npx playwright test --trace on`) for regressions, and stash artifacts in `test-results/`.

## Commit & Pull Request Guidelines
- Follow the repo’s concise, present-tense commit style (`Refactoring the activities`, `Added pm2 scripts`); keep subject ≤72 characters and expand context in the body if needed.
- Reference relevant issues or Supabase migration IDs in the body, and mention environment impacts.
- For PRs, include: purpose summary, screenshots for UI updates, database or Supabase notes, test evidence (`npm run test` output), and rollout considerations.

## Supabase & Environment Notes
- Store secrets in `.env`; copy from `.env.example` when available and never commit credentials.
- Use `npm run db:diff "migration-name"` to scaffold schema changes, then apply with `npm run db:push`.
- After schema updates, refresh generated types or client helpers in `src/lib/supabase` to keep type safety intact.
