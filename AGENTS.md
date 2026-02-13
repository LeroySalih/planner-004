# Planner Agents Playbook

This guide captures the working knowledge future coding agents need to extend the planner app confidently. Keep it close whenever you write, refactor, or review code here.

## Stack Snapshot
- Next.js 15 App Router with React 19 server and client components (`src/app/page.tsx`).
- TypeScript throughout; validation expressed with Zod schemas in `src/types/index.ts`.
- Tailwind CSS v4 with Radix UI primitives and shared wrappers under `src/components/ui`.
- PostgreSQL database accessed via `pg` library with connection pooling in `src/lib/db.ts`. Custom session-based authentication managed in `src/lib/auth.ts`.
- SSE (Server-Sent Events) for real-time updates via custom hub implementation in `src/lib/sse/hub.ts`.
- Playwright drives end-to-end coverage (`tests/sign-in/teacher-sign-in.spec.ts`).

## Directory Landmarks
- `src/app` – Route handlers, layouts, and feature entrypoints. For example, `src/app/assignments/page.tsx` composes Assignment Manager data on the server.
- `src/components` – Reusable UI and composite widgets. Feature bundles like `src/components/assignment-manager` plug into pages.
- `src/actions` – Ad-hoc server-side helpers that do not yet live in the consolidated action modules.
- `src/lib` – Domain helpers and service clients. Key files: `src/lib/server-updates.ts` (server action barrel), `src/lib/auth.ts` (auth guards), `src/lib/db.ts` (PostgreSQL connection), `src/lib/utils.ts` (utility helpers).
- `src/types` – Canonical Zod schemas and inferred types that mirror database tables.
- `src/migrations` – SQL migrations for schema changes.
- `tests` – Playwright specs plus `.env.test` fixture configuration.
- `bin` – Shell script for database sync (`prod2dev.sh`).
- `scripts` – Database and utility scripts (`db_clean.sh`, etc.).
- `MCP` – Standalone Model Context Protocol server that exposes curated planner resources/tools to coding agents (`npm run dev` to watch).

## Core Domain & Data Contracts
- Treat Zod schemas in `src/types/index.ts` as the source of truth for planner entities (groups, units, lessons, assignments, feedback). Extend or reuse these instead of recreating ad-hoc shapes.
- Many server actions parse and return `{ data, error }` envelopes validated with these schemas (see `src/lib/server-actions/groups.ts`). When adding APIs, stick to the same pattern for consistency and predictable error handling.
- Assignment-related UI expects `Assignments`, `LessonAssignments`, and `LessonAssignmentScoreSummaries` shaped exactly like the schemas; ensure backend changes keep these contracts intact (`src/components/assignment-manager/assignment-manager.tsx`).
- Report level lookups reference the boundary helper in `src/lib/levels/index.ts`; update that file (not ad-hoc math) if the scale shifts.

## Database & Server Actions
- Use `query()` from `src/lib/db.ts` for database access in server components/actions. Connection pooling with automatic retry logic handles connection issues.
- Database connection via `DATABASE_URL` environment variable, SSL configuration auto-detected based on hostname.
- All server actions are exported through `src/lib/server-updates.ts`; add new domain actions there so pages/components can consume a single barrel.
- Follow the defensive error handling shown in `src/lib/server-actions/feedback.ts`—parse input with Zod, wrap database calls in try/catch, and surface a safe error string.
- Authorization helpers like `requireTeacherProfile()` and `requireRole()` live in `src/lib/auth.ts`; enforce these guards in route handlers before performing privileged operations (`src/app/assignments/page.tsx`).
- Minimise redundant calls to `requireTeacherProfile()` by fetching the profile once per request/action and passing the result to downstream logic rather than invoking the guard repeatedly.
- `/assignments` must hydrate via the `assignments_bootstrap` RPC (`readAssignmentsBootstrapAction`) and compute lesson averages through `lesson_assignment_score_summaries` (`readLessonAssignmentScoreSummariesAction`); extend those RPCs when new data is needed instead of layering extra database queries.
- `/pupil-lessons` now relies on two RPCs: `pupil_lessons_summary_bootstrap(p_target_user_id)` for the teacher landing summaries and `pupil_lessons_detail_bootstrap(p_target_user_id)` for the pupil detail view. Call them through `readPupilLessonsSummaryBootstrapAction` / `readPupilLessonsDetailBootstrapAction` and keep the JSON shaping on the Next.js server (clients should never see the raw payloads).
- Use pure server components where possible.
- Standardise write flows on the async pattern prototyped in `/prototypes/fast-ui`: server actions validate and respond immediately, queue the heavy work (e.g. long-running database mutation or background enrichment), then broadcast completion via SSE (Server-Sent Events). Always wrap the action with `withTelemetry` for timing data, log queue events, and ensure the client subscribes to the SSE endpoint so optimistic UI stays in sync. Client components should use `useActionState` for loaders, update local state optimistically, and surface both success and failure via `sonner` toasts while keeping buttons interactive for follow-up attempts.

## Client/UI Conventions
- All data fetching on the client must utilise a server action. Never access the database directly from client components to prevent credential leaks.
- Prefer server side rendering, with Suspense where possible, over client side fetching.
- Compose UI with the Radix-backed primitives from `src/components/ui` (e.g. `button.tsx:1`, `form.tsx:1`, `dropdown-menu.tsx`). Wire class names through the `cn` helper (`src/lib/utils.ts:1`) to maintain Tailwind merge behaviour.
- Long-form feature components (e.g. `src/components/assignment-manager/assignment-manager.tsx:1`) separate stateful logic and per-pane subcomponents. Mirror this pattern when introducing new management consoles.
- Styling tokens and dark mode variants come from `src/app/globals.css:1`; keep new Tailwind classes aligned with the defined palette.
- Prefer functional components and React hooks. When building forms, wrap them with the shared Form provider to integrate validation and accessible labelling (`src/components/ui/form.tsx:1`).
- Toast notifications rely on `sonner`; reuse the existing pattern from Assignment Manager when showing optimistic updates.
- Server functions need to use some form of loader animation in the button to let the user know that the action is in progress.  use the useActionState hook whenever the user presses a button that interacts with the server.

## Testing & Quality
- There are no end to end tests.
- There are no unit test utilities yet; if you introduce them, document their usage here and wire them into `npm run test`.
- Do not run `npm run lint` (Next/ESLint) and `npm run test` (Playwright) before surfacing changes. For flaky UI steps, capture traces with `TRACE=1 npm run test`.

## Telemetry data
- All server side functions should include the ability to display telemtry performance data.  This data will include:
    - function name, any params passes.
    - function end - function start in millisecs.
    - function end - authentication end in milliseconds.
- telemtry data will by enabled by an environment variable TELEM_ENABLED=true.  A second variable, TELEM_PATH, will allow the developer to only generate telemetry data for a specifc path, e.g. TELEM_PATH=reports will only display data for the /reports path.
-TELEM data is written to a log file, logs/telem_<TIMESTAMP>.log


## Tooling & Workflows
- Scripts in `package.json` cover the usual dev, build, lint, and test tasks. Database helpers: `db:prod2dev` (sync production to dev), `db:clean` (clean database).
- SQL migrations stored in `src/migrations/`. Create new migrations and apply them to keep schema in sync.
- The MCP server under `/MCP` is its own Node workspace (`npm install` already committed). Use `npm run dev` for hot reload via `tsx watch`, or `npm start` for a single run; the HTTP endpoint defaults to `http://127.0.0.1:4545/mcp`. Exposed resources include `planner://playbook`, `planner://todos`, and `planner://file/{path}` (pinned paths from `MCP_PINNED_FILES`). Tools currently shipped: `read_workspace_file` (returns snippets with byte limits) and `search_todos` (finds lines in `todos.md`). Environment knobs: `MCP_PORT`, `MCP_HOST`, `MCP_ROUTE`, `MCP_PINNED_FILES` (comma list), `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS`, `MCP_ENABLE_DNS_REBINDING_PROTECTION`, and `MCP_FILE_BYTE_LIMIT`.

## Implementation Checklist
1. Confirm the relevant Zod schema exists or add one in `src/types/index.ts` before touching UI or database logic.
2. Expose new server mutations or queries through the `src/lib/server-actions/*` modules and re-export from `src/lib/server-updates.ts`.
3. Guard server routes with `requireAuthenticatedProfile()`, `requireTeacherProfile()`, or `requireRole()` where needed (`src/lib/auth.ts`).
4. Build UI using existing primitives, keep indentation at two spaces, and leverage `cn()` for class composition.
5. Wire optimistic updates carefully—use `useTransition` and state snapshots like in the Assignment Manager to keep UI responsive.
6. Update or add Playwright specs covering the user-visible change; store connections to seeded data where possible.
7. Document any new workflows or scripts by appending to this playbook so the next agent inherits the context.

Stay vigilant for unexpected file changes. If database tables or shared types evolve, ripple the updates through server actions, client components, and tests in one pass to avoid drift.
.

# Dates
Dates should be displayed in DD-mm-yyyy format.
Weeks start on Sunday, Friday and Saturday are non working days. 