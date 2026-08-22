# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Workflow

When implementing multi-step tasks, always use **subagent-driven development** (`superpowers:subagent-driven-development`) without waiting for confirmation. Dispatch a fresh subagent per task, run spec compliance review then code quality review after each, and proceed automatically through all tasks.

After writing a plan with `superpowers:writing-plans`, **always** proceed immediately with subagent-driven execution — never offer an execution choice or wait for the user to select an approach.

## Project Overview

Planner 004 is a Next.js 15 education planning application for managing curricula, lessons, units, assignments, and pupil feedback. The app uses the App Router with React 19, TypeScript, and PostgreSQL for data persistence.

## Development Commands

```bash
# Development
pnpm install
pnpm dev                    # Start development server at http://localhost:3000

# Build and Production
pnpm build                  # writes .next — kills a dev server running on the same directory
pnpm start

# Quality Checks
pnpm lint                   # Run ESLint
pnpm test                   # Run Playwright E2E tests
pnpm build:check            # Verification build that does NOT disturb a running dev server

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

**Before merging a worktree**, always run `git status` inside the worktree and commit any untracked files that belong to the feature. Untracked files are invisible to git and will not be included in a merge, causing build failures on production. Every new file created during development must be explicitly `git add`-ed before committing.

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
│   ├── public/      # Unauthenticated public lesson browser components
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

### Static File Serving

Files placed in `public/` are served at the root URL with no auth — e.g. `public/pages/foo.html` → `https://dino.mr-salih.org/pages/foo.html`.

## Key Data Contracts

**Assignment Data Flow**:
- `/assignments` hydrates via `assignments_bootstrap` RPC (call through `readAssignmentsBootstrapAction`)
- Lesson averages computed via `lesson_assignment_score_summaries` RPC
- Extend RPCs for new data needs rather than adding separate queries

**Pupil Lessons**:
- Teacher summary: `pupil_lessons_summary_bootstrap(p_target_user_id)` via `readPupilLessonsSummaryBootstrapAction`
- Pupil detail: `pupil_lessons_detail_bootstrap(p_target_user_id)` via `readPupilLessonsDetailBootstrapAction`
- Always shape JSON on Next.js server, never expose raw RPC payloads to clients

**Public Lessons**:
- `lessons.is_public boolean DEFAULT false NOT NULL` — controls unauthenticated visibility
- `readPublicLessonsAction()` — returns all public lessons grouped by curriculum/unit (no auth required)
- `readPublicLessonActivitiesAction(lessonId)` — returns only `PUBLIC_ACTIVITY_TYPES` activities for a public lesson
- `toggleLessonPublicAction(lessonId, isPublic)` — teacher-only toggle; revalidates both the lesson page and `/signin`
- `PUBLIC_ACTIVITY_TYPES` in `src/dino.config.ts` — static display types only (`text`, `display-image`, `show-video`, `display-section`, `display-flashcards`); scorable and interactive types are hidden from public view
- `/signin` is the public lesson browser — split layout: scrollable left panel (hero + filter chips + unit cards), fixed right panel (sign-in form)
- Direct lesson links (`/lessons/[id]`) work without auth for public lessons; private lessons redirect to `/signin?returnTo=…`
- Unit page (`/units/[id]`) shows a globe icon on every lesson — green = public, grey = private; clicking the icon toggles `is_public`

**Report Levels**: Use boundary helper in `src/lib/levels/index.ts` for level lookups - update centrally if scale changes.

## AI Marking Pipeline

**Models are called directly from the server — there is no n8n.** The queue
worker calls Gemini and applies the result in the same pass:

```
external_jobs (ai_mark) ──▶ markWithModel() ──▶ applyAiMarkPayload()
```

There are no marking webhooks. A failed model call throws, which the existing
`attempts` / `process_after` backoff in `external_jobs` retries, and a permanent
failure lands the submission in `marking-error`.

Module names are deliberately provider-neutral — models are now selectable per
activity (see *Choosing the model per activity*), so a name like
`gemini-client` would be a lie the first time a route points elsewhere. The
wire format inside `model-client.ts` is currently Gemini's; callers only ever
pass a model id.

- `src/lib/ai/model-client.ts` — shared transport: retry on 429/500/503, optional `responseSchema`
- `src/lib/ai/marking.ts` — the marking prompt, text and vision
- `src/lib/ai/ocr.ts` — worksheet transcription
- `src/lib/ai/model-output-guard.ts` — rejects replies a model mangled while
  emitting JSON. Corrupted escaping still parses as valid JSON, so without this
  a garbled sentence reaches the pupil with no error raised anywhere.
- `src/lib/ai/anthropic-client.ts` — Anthropic transport, via the official
  `@anthropic-ai/sdk`. Chat-shaped (system + multi-turn history + parts +
  schema) because `ModelRequest` carries a single user turn. Converts Gemini's
  upper-case response schemas to standard JSON Schema and adds the
  `additionalProperties: false` Claude requires.
- `src/lib/ai/lesson-chat.ts`, `src/lib/ai/unit-chat.ts` — **run on Claude**
  (`claude-sonnet-5`). `generateImage` in lesson-chat is the exception and stays
  on Gemini, because Claude does not generate images.

Two things bite when moving a surface from Gemini to Claude:

- **`temperature` is rejected.** Sonnet 5 and Opus 5 return 400 for non-default
  sampling parameters. Both chats previously set `temperature: 0.4`; steer with
  the system prompt instead.
- **The assistant role is `assistant`, not `model`.** Gemini's history format
  uses `model`; passing that through is a 400.

Requires `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`) — enforced in
`required-env.ts`, because a missing key takes both authoring surfaces down.

**Marking runs on Claude too, as of migration 089** (`claude-sonnet-5` for all
five AI-marked types). `callModel` dispatches on `request.provider`, so a route
change at `/admin/ai-models` is all it takes to move a type between providers —
no code change. `ocr.ts` follows the `upload-worksheet` route rather than
hardcoding a provider: transcription is the first half of that activity's
marking, and leaving it on Gemini would mean the mark ran on Claude while the
transcription it depends on still hit a geo-blocked endpoint.

Sonnet 5 was chosen on evidence, not preference — see the rationale in
migration 089. Gemini remains selectable and is still the only option for image
*generation* (`generateImage`, `sketch-render`), which Claude cannot do.

`model-output-guard.ts` runs in **prose mode** by default, where a lone line
break is a corruption signature. Pass `allowLineBreaks` for legitimately
multi-line output such as OCR transcription, or every multi-line worksheet is
rejected.

### Every model call is configurable

There are no hardcoded model ids left in call sites. Non-activity surfaces share
the `ai_model_routes` table using a `surface:` prefix in `activity_type`
(migration 090), so there is one table, one resolver and one admin screen rather
than a second mechanism that drifts:

| Surface key | Used by |
|---|---|
| `surface:lesson-chat` / `surface:unit-chat` | the two *Develop with AI* panels |
| `surface:worksheet-ocr` | transcription before `upload-worksheet` marking |
| `surface:handwriting-ocr` | the standalone `/ocr` tool |
| `surface:sketch-guardrail` | prompt check before a sketch render |
| `surface:image-generation` | sketch render + AI-proposed lesson images |

Catalogue entries carry `kind: "text" | "image"`, and the admin screen only
offers models that can do the job — image generation cannot run on a text model
or the reverse. `resolveModelRoute` returns a provider as well as a model, so
image surfaces additionally assert `provider === "google"`: no Anthropic model
generates images, and a route pointing elsewhere is a misconfiguration worth
surfacing rather than an endpoint worth attempting.

`DEFAULT_CHAT_MODEL` and `defaultMarkingModel()` are the only remaining literals
and are deliberate: they are last-resort fallbacks for when the routes table
cannot be read. A surface that fails because the database is down would be worse
than one running on a sensible default.

### Image generation is mothballed

`IMAGE_GENERATION_ENABLED` in `src/dino.config.ts` is `false`. The only models
that generate images are Google's, which are geo-blocked from Saudi Arabia, and
Claude cannot generate images at all.

**No generation code was removed** — this hides the capability at the two points
where it can be *introduced*: `sketch-render` is filtered out of the lesson
activity picker, and the AI chat drops `imagePrompt` proposals with a note to the
teacher. Existing sketch-render activities still render, still accept pupil work
and still appear in reports; and the type stays selectable when editing an
activity that already uses it, so opening one does not silently rewrite its type
on save. Flip the flag to revive — nothing else needs changing.
- `src/lib/ai/marking-queue.ts` — claim, fan out, call, apply, resolve
- `src/lib/ai/apply-ai-mark.ts` — applies a result; **returns `ok:false` for
  permanent problems rather than throwing**, so callers must check it or the job
  resolves and the submission is stranded in `marking`

Requires `GOOGLE_API_KEY` (or `GEMINI_API_KEY`). `GEMINI_MARKING_MODEL`
overrides the model. `AI_MARKING_CALLBACK_URL` is still required but now only
supplies the app's own origin for self-triggering the queue processor.

### Per-criterion marking

An activity with success criteria is marked **once per criterion** — one
`external_jobs` row each, one model call each, assessed independently.

- `success_criteria.sc_type` is `binary` (0–1) or `levelled` (0–n over n
  ascending `success_criteria_descriptors`). **Not** the pre-existing
  `success_criteria.level` column, which is unrelated attainment metadata.
- `activities.max_marks` is **derived** for any activity with criteria:
  `Σ(binary → 1, levelled → n)`. Deterministic types (`DETERMINISTIC_ACTIVITY_TYPES`)
  cap at 1; non-scorable types are excluded. Recalculate via
  `src/lib/scoring/derive-max-marks.ts` from every surface that changes a
  criterion's type, descriptors or activity links — criteria are shared, so one
  edit can change `max_marks` on many activities.
- `submission_sc_marks` is authoritative. The normalised aggregate is cached to
  `body.ai_model_score` because that is what `compute_submission_base_score`
  reads, so existing reporting works unchanged.
- `provenance` is `ai` | `teacher` | `legacy`. Teacher rows survive a re-mark.
  `legacy` rows were migrated from the old uniform fill and are derived, not
  real assessment.
- **Teacher marks and comments always override.** `effectiveCriterionFeedback`
  in `aggregate-sc-marks.ts` is the single rule: a teacher's comment wins; if
  the teacher changed the mark without commenting, the AI's comment is
  suppressed rather than left contradicting the new mark.
- The prompt must state that **0 is a valid score**. Without it the model
  anchors to the lowest descriptor and silently inflates every mark.

### Choosing the model per activity

Which model marks which activity is configured at **`/admin/ai-models`**, not in
code. Routes live in `ai_model_routes` (migration 088) keyed on
`(activity_type, sc_type)`, and resolve most-specific-first:

```
(activity type, criterion type) -> (activity type, NULL) -> DEFAULT_ROUTE
```

`DEFAULT_ROUTE` in `src/lib/ai/model-routing.ts` is deliberately identical to
the old `defaultMarkingModel()`, so an install with no rows — or with migration
088 unapplied — behaves exactly as it did before the table existed.

- Resolution happens once per marking call in `marking-queue.ts`, after the
  per-type branches, so a new activity type is routed without extra wiring.
- Routes are cached in-process for 30s. The queue worker is long-lived and there
  may be several under PM2, so an admin edit must reach them without a restart —
  hence a TTL rather than an indefinite cache.
- `MODEL_CATALOGUE` carries an `available` flag. The Anthropic models are listed
  but unselectable while marking still runs through the Gemini transport;
  selecting one is rejected in the server action *and* guarded in the queue,
  because a Claude model id sent to the Gemini endpoint fails as an opaque 404.
- **API keys are not stored here.** They stay in `.env`; the page reports only
  whether each provider's key is present. `ANTHROPIC_API_KEY` and
  `CLAUDE_API_KEY` are both accepted.
- `AI_MARKED_ACTIVITY_TYPES` in `src/dino.config.ts` decides which types the
  page lists. Keep it in step with the AI branch of
  `compute_submission_base_score`, or a type will be marked but read back as
  unscored.

### Reviewing chat runs

Chat calls were invisible until migration 091 — a failure gave a stack trace
and no way to see the reply that caused it. They now write a
`job_type = 'chat'` row to `external_jobs` via `recordModelCall`
(`model-call-log.ts`), sharing the table so there is one place to answer "what
did we send a model, and what came back".

These are log entries, not work:

- Written with `status = 'done'` **even on failure**. The queue claims
  `status = 'pending'` *and* `job_type = 'ai_mark'`, so they are doubly
  unclaimable — and `pruneDoneJobs` only sweeps `'done'`, so writing failures as
  `'error'` would leave them accumulating forever. Success and failure are told
  apart by `last_error`, not by status.
- Written fire-and-forget; losing a log line must never take down the surface
  being logged.
- Attachment **metadata only**, same reasoning as marking's image payloads.
- `system` and `raw` are truncated to 4 000 chars with the true length kept
  alongside — the injected unit context can be very large.

The failure path logs the reply too, which is the whole point: a guard rejection
happens *after* a successful call, so the reply it rejected is the most useful
thing to look at.

```sql
-- recent chat calls, failures first
select updated_at,
       model_request->>'surface'            as surface,
       model_request->>'model'              as model,
       model_request->'userMessage'->>'text' as asked,
       model_response->'message'->>'text'   as replied,
       model_response->'raw'->>'text'       as raw_reply,
       duration_ms, last_error
from external_jobs
where job_type = 'chat'
order by (last_error is not null) desc, updated_at desc
limit 20;
```

### Reviewing marking runs

Every `ai_mark` job records its model call on the queue row: `model_request`
(prompt, system text, per-image metadata), `model_response` (parsed marks,
feedback, raw reply truncated to 4 000 chars) and `duration_ms`.

**Base64 image data is deliberately not stored** — a worksheet request carries
several MB of it. Only `{fileName, mimeType, bytes}` per image is kept.

Completed `ai_mark` rows are no longer deleted on completion; they age out on
the generic 7-day sweep (`pruneDoneJobs`) along with every other job type.

```sql
-- slowest marking calls in the last day
select duration_ms,
       model_request->>'model'        as model,
       model_request->>'scType'       as sc_type,
       (model_response->>'marksAwarded')::int as awarded,
       payload->>'submissionId'       as submission
from external_jobs
where job_type = 'ai_mark' and model_request is not null
  and updated_at > now() - interval '1 day'
order by duration_ms desc
limit 20;
```

Gather is concurrency-sensitive: `processNextQueueItem` runs a batch through
`Promise.allSettled`, so sibling criterion results for one submission arrive
together. `recordCriterionMark` takes `select … for update` on the submission
row before deciding whether the set is complete.

## Scoring Conventions

**Always use `compute_submission_base_score(body, activity_type)`** when computing a submission score in SQL. This is the canonical PostgreSQL function (defined in `schema.sql`) and handles all score fields in the correct priority order:

1. `teacher_override_score` / `override_score` — teacher manually overrides any auto score
2. `multiple-choice-question`: `is_correct` → 1 or 0, fallback to `score` / `auto_score`
3. `short-text-question`: `teacher_ai_score` → `ai_model_score` → `score` → `auto_score`
4. All other scorable types: `score` → `auto_score`
5. Returns `NULL` if the submission exists but has no score yet (not 0)

**Never write ad-hoc COALESCE chains** over individual body fields — they will miss score fields and produce incorrect results. The function accepts both `json` and `jsonb` so it works with the `submissions.body` column directly.

**Scorable activity types** are defined in `src/dino.config.ts` as `SCORABLE_ACTIVITY_TYPES`. Use `isScorableActivityType()` from that module when filtering in TypeScript, and pass the same array as a parameter when filtering in SQL.

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

## Security

- **All secrets and tokens must live in `.env` only** — never hardcode them in `.mcp.json`, config files, or source code. Both `.env` and `.mcp.json` are gitignored, but `.env` is the single source of truth for credentials. Reference tokens in `.mcp.json` via `${ENV_VAR}` syntax.
- Generate new tokens with `openssl rand -hex 20`.

## Important Notes from AGENTS.md

- **Do not use Supabase client in browser** - all data access via server actions to prevent credential leaks
- Standardize write flows on async pattern from `/prototypes/fast-ui` where appropriate
- Keep buttons interactive during server actions (use proper loading states, allow retries on failure)
- Long-form feature components (e.g., Assignment Manager) separate stateful logic into subcomponents
- SQL migrations in `src/migrations/` (note: no `supabase/` directory in this project)
- Scripts in `scripts/` and `bin/` directories for database sync and utilities
- MCP server lives at `src/app/api/MCP/route.ts` — there is no separate `MCP/` directory

## SQL Gotchas

### units → curricula join is via subject, not a foreign key

`units` has no `curriculum_id` column. Join curricula to units like this:

```sql
JOIN curricula c ON c.subject = u.subject
```

A single unit subject can match multiple curricula — use `DISTINCT ON (l.lesson_id)` when you need one row per lesson.

### Unit ↔ curriculum link (one curriculum per unit)

`units.curriculum_id` (nullable FK → `curricula`) ties a unit to a single curriculum. A unit may only be assigned LOs/SCs from that curriculum. Enforcement is centralised in **`src/lib/curriculum/unit-curriculum-guard.ts`** — call the appropriate `assert…AllowedFor…` helper from ANY new path that links an SC/LO to a unit, lesson, or activity (app actions, MCP helpers, AI chat). The four assignment surfaces are `success_criteria_units`, `lessons_learning_objective`, `lesson_success_criteria`, `activity_success_criteria`. First assignment fixes the unit's curriculum; a mismatch throws `UnitCurriculumMismatchError`. Items under a bespoke unit-owned AO (`assessment_objectives.curriculum_id` null) are exempt.

- Audit/backfill: `npx tsx scripts/audit-unit-curricula.ts [--dry-run]` (auto-sets single-curriculum units; reports multi-curriculum ones).
- Admin remediation: `/admin/unit-curricula` — "keep this curriculum" removes the other curricula's LOs/SCs from the unit AND from its lessons/activities via `removeCurriculumFromUnit`.

### Nullable boolean columns — use IS NOT FALSE

Several `active` columns default to `NULL` in production rows. `WHERE active = true` silently excludes those rows. Always write:

```sql
WHERE l.active IS NOT FALSE
  AND u.active IS NOT FALSE
  AND c.active IS NOT FALSE
```

## MCP Server — Known Gotchas

The MCP server lives at `src/app/api/MCP/route.ts`. Full tool reference: `docs/MCP.md`.

### z.array() parameters must use z.preprocess

The MCP SDK serialises **all** tool call parameters as strings before sending them to the server. Zod's `z.record()` coerces a JSON-object string automatically, but `z.array()` does **not**. Any tool input that is an array must be wrapped:

```ts
// WRONG — will throw "expected array, received string" at runtime
mcq_options: z.array(z.object({ id: z.string(), text: z.string() })).optional()

// CORRECT
mcq_options: z.preprocess(
  (v) => (typeof v === 'string' ? JSON.parse(v) : v),
  z.array(z.object({ id: z.string(), text: z.string() })),
).optional()
```

### short-text-question and multiple-choice-question body_data field names

These types use **camelCase** field names inside `body_data` — matching the Zod schemas in `src/types/index.ts`:

| Type | Required `body_data` fields |
|---|---|
| `short-text-question` | `{ question: string, modelAnswer: string }` |
| `multiple-choice-question` | `{ question: string, options: [{id, text}], correctOptionId: string }` |

**Do not use** `model_answer` or `correct_option_id` inside `body_data` — those are the MCP input parameter names only. The handler converts them to camelCase before writing to the DB.

### STQ and MCQ use dedicated top-level params, not body_data

When calling `create_activity` or `update_activity` for `short-text-question` or `multiple-choice-question`, pass the structured params (`question`, `model_answer`, `mcq_options`, `correct_option_id`) at the **top level** of the tool input. Do **not** pass `body_data` for these types — the handler ignores `body_data` and builds it from the structured params.

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
