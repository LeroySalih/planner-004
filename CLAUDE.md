# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Planner 004 is a Next.js 15 education planning application for managing curricula, lessons, units, assignments, and pupil feedback. The app uses the App Router with React 19, TypeScript, and PostgreSQL for data persistence.

## Development Commands

```bash
# Development
pnpm install
pnpm dev                    # Start development server at http://localhost:3000

# Build and Production
pnpm build
pnpm start

# Quality Checks
pnpm lint                   # Run ESLint
pnpm test                   # Run Playwright E2E tests

# Database
pnpm db:prod2dev           # Sync production data to dev (bash ./bin/prod2dev.sh)
pnpm db:clean              # Clean database (bash ./scripts/db_clean.sh)

# PM2 Deployment
pnpm pm2:restart           # Stop and delete existing PM2 process
pnpm pm2:start             # Start app with PM2 as "dino.mr-salih.org"

# Playwright
pnpm record-test <folder> <name>  # Record new test: npx playwright codegen --output tests/<folder>/<name>.spec.ts
```

## Git Worktrees with Isolated Databases

This project supports isolated development environments using git worktrees with separate database instances:

```bash
# 1. Create a new worktree (creates .worktrees/<branch-name>)
git worktree add .worktrees/feature-name -b feature/feature-name

# 2. Setup isolated database and environment (with auto-start in tmux)
./scripts/setup-worktree-db.sh feature-name --start-server
# - Creates postgres-feature-name database
# - Copies and configures .env
# - Starts dev server in tmux session on available port (3001+)
# - Session name: worktree-feature-name

# Alternative: Setup without auto-start (manual workflow)
./scripts/setup-worktree-db.sh feature-name
cd .worktrees/feature-name
pnpm install
pnpm dev

# 3. Manage tmux sessions
tmux attach -t worktree-feature-name      # View server logs
tmux ls                                   # List all sessions
tmux kill-session -t worktree-feature-name  # Stop server

# 4. Run dev servers for multiple worktrees
./scripts/dev-worktree.sh feature-name    # Single worktree
./scripts/dev-multi.sh                    # All worktrees (main:3000, worktrees:3001+)

# 5. Cleanup when done
tmux kill-session -t worktree-feature-name  # Stop server
git worktree remove .worktrees/feature-name
# Optional: Drop the database
psql -U postgres -c "DROP DATABASE \"postgres-feature-name\";"
```

**Database Isolation**: Each worktree gets its own `postgres-<worktree-name>` database cloned from the main `postgres` database. This prevents development work from interfering across branches.

**Tmux Sessions**: The `--start-server` flag automatically starts the dev server in a detached tmux session, allowing parallel development across multiple worktrees without terminal window management.

## Core Architecture

### Data Layer

**Direct PostgreSQL via `pg` library** - Not using Supabase client SDK despite dependencies. All database access goes through:
- `src/lib/db.ts` - Connection pooling with retry logic, `query()` and `withDbClient()` helpers
- Connection string from `DATABASE_URL` environment variable
- SSL auto-detection based on hostname and connection string parameters

**Server Actions Pattern** - All mutations and queries exposed through server actions:
- Individual domain actions in `src/lib/server-actions/*.ts`
- Consolidated re-exports through `src/lib/server-updates.ts` (single import point for consumers)
- Standard return shape: `{ data, error }` with Zod-validated schemas
- Guard routes with `requireAuthenticatedProfile()` or `requireRole('teacher')` from `src/lib/auth.ts`

**Type Safety** - Zod schemas in `src/types/index.ts` are the source of truth:
- Mirror PostgreSQL table structures
- Used for both validation and TypeScript type inference
- All server actions parse inputs and outputs against these schemas

### Authentication & Authorization

Custom session-based auth (not Supabase Auth):
- Session tokens stored in `planner_session` cookie (1-hour rolling TTL)
- `src/lib/auth.ts`: `getAuthenticatedProfile()`, `requireRole()`, `hasRole()`
- Role-based access control stored in database, checked via helper functions
- Bcrypt password hashing with cost factor 10

### Client/Server Boundaries

**Server-First Pattern**:
- Prefer server components with Suspense for data fetching
- All client-side data access MUST use server actions (never direct database queries from browser)
- Client components use `useActionState` for server action integration with loading states
- Optimistic updates pattern: update local state, call action, handle success/error with `sonner` toasts

**Fast UI Prototype** (`src/lib/prototypes/fast-ui.ts`):
- Async pattern: action responds immediately, queues heavy work, broadcasts completion
- Wrap actions with `withTelemetry` for performance tracking
- Client subscribes via Realtime for eventual consistency

### UI Components

- **Radix UI primitives** wrapped in `src/components/ui/` (buttons, forms, dialogs, etc.)
- **Tailwind CSS v4** for styling, `cn()` helper from `src/lib/utils.ts` for class merging
- **Dark mode** via `next-themes`, tokens in `src/app/globals.css`
- **Forms** use react-hook-form + Zod resolvers, wrapped with Form provider for accessibility
- **Toasts** via `sonner` library for user feedback
- Loading states required for all button interactions with server actions

### Feature Organization

```
src/
├── app/              # Routes, layouts, pages (App Router)
├── components/       # Reusable UI and feature-specific components
│   ├── ui/          # Radix-wrapped primitives
│   └── */           # Feature bundles (e.g., assignment-manager/)
├── lib/
│   ├── server-actions/  # Domain-specific server actions
│   ├── auth.ts         # Authentication guards and helpers
│   ├── db.ts           # PostgreSQL connection and query functions
│   ├── telemetry.ts    # Performance tracking wrapper
│   └── utils.ts        # Shared utilities (cn, etc.)
├── types/           # Zod schemas and inferred TypeScript types
└── actions/         # Legacy ad-hoc helpers (prefer server-actions/)
```

## Key Data Contracts

**Assignment Data Flow**:
- `/assignments` hydrates via `assignments_bootstrap` RPC (call through `readAssignmentsBootstrapAction`)
- Lesson averages computed via `lesson_assignment_score_summaries` RPC
- Extend RPCs for new data needs rather than adding separate queries

**Pupil Lessons**:
- Teacher summary: `pupil_lessons_summary_bootstrap(p_target_user_id)` via `readPupilLessonsSummaryBootstrapAction`
- Pupil detail: `pupil_lessons_detail_bootstrap(p_target_user_id)` via `readPupilLessonsDetailBootstrapAction`
- Always shape JSON on Next.js server, never expose raw RPC payloads to clients

**Report Levels**: Use boundary helper in `src/lib/levels/index.ts` for level lookups - update centrally if scale changes.

## Telemetry

All server functions should use `withTelemetry` wrapper for performance tracking:
- Captures function name, parameters, duration in milliseconds
- Tracks time since authentication end for request latency insights
- Controlled by environment variables:
  - `TELEM_ENABLED=true` to enable
  - `TELEM_PATH=reports` to filter by route path (comma-separated)
- Logs written to `logs/telem_<timestamp>.log`

## Testing

- **E2E tests**: Playwright specs in `tests/` directory
- No unit test infrastructure yet
- Test environment config in `tests/.env.test`
- Run with trace capture: `TRACE=1 pnpm test`

## Coding Conventions

1. **Two-space indentation** throughout
2. **Server actions**: Validate with Zod, wrap Supabase calls in try/catch, return `{ data, error }`
3. **Authorization**: Minimize redundant `requireAuthenticatedProfile()` calls - fetch once and pass down
4. **Avoid over-engineering**: Don't add features, helpers, or abstractions beyond current requirements
5. **Dates**: Display as DD-MM-YYYY format. Weeks start Sunday, Friday-Saturday are non-working days
6. **No backwards-compatibility hacks**: Delete unused code completely instead of commenting or renaming with underscore prefixes

## Important Notes from AGENTS.md

- **Do not use Supabase client in browser** - all data access via server actions to prevent credential leaks
- Standardize write flows on async pattern from `/prototypes/fast-ui` where appropriate
- Keep buttons interactive during server actions (use proper loading states, allow retries on failure)
- Long-form feature components (e.g., Assignment Manager) separate stateful logic into subcomponents
- SQL migrations in `src/migrations/` (note: no `supabase/` directory in this project)
- Scripts in `scripts/` and `bin/` directories for database sync and utilities
- MCP server in `MCP/` directory (`npm run dev` for hot reload, exposes planner resources/tools)

## Design History - Rejected Approaches

### Markdown-Based Curriculum Editor (Feb 2026)

**Approach**: Experimented with a document-style markdown editor for curriculum management at `/tests/curriculum`. The interface featured:
- Split-panel layout with markdown editor (left) and live change preview (right)
- 4-digit line numbers for error navigation
- Markdown syntax: `# AO1: Title` for Assessment Objectives, `## LO: Title` for Learning Objectives, `- Description [L3]` for Success Criteria
- Auto-save with 3-second debounce
- Content-based change detection using Levenshtein distance (90% similarity threshold)
- Real-time change tracking showing added/modified/deleted/reordered items
- Single undo functionality
- Server action `saveCurriculumStructureAction` for persisting parsed markdown to database

**Testing**: Implemented in isolated `test-curriculum-ui` worktree with dedicated database. Full implementation completed including:
- Markdown parser with error reporting
- Change detection system
- Server-side diff calculation and database persistence
- UI components for change visualization

**Decision**: **Rejected** - Too technical and intimidating for non-technical teachers
- Markdown syntax presents a learning barrier for educators unfamiliar with markup languages
- Parse errors with line numbers require technical debugging mindset
- Risk of user errors (incorrect syntax) leading to data loss
- Form-based UI is more intuitive and prevents structural errors

**Data Integrity Issue Discovered**: Investigation revealed critical bug in curriculum deletion flow:
- `lesson_success_criteria`, `activity_success_criteria`, and `feedback` tables lack foreign key constraints to `success_criteria`
- Deleting Learning Objectives/Success Criteria orphans student work and scores
- Recommendation: Implement soft delete (set `active = false`) or add validation to prevent deletion of in-use curriculum items

**Current State**: Form-based curriculum builder at `/curriculum/[curriculumId]` remains the production interface. All markdown editor code removed from main codebase (Feb 13, 2026).
