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
- **Default password must be changed.** `profiles.must_change_password` (migration 118) is set when a teacher resets a password to the default, when anyone signs in with the default password, and by the migration for accounts still on the column's default hash. While it is set, `getAuthenticatedProfile` redirects every page, action and route to `/change-password`. Setting a password of your own clears it, and the default is refused. The default lives in `src/lib/default-password.ts`.
- **Forgot password** by an emailed one-time link: see *Forgot password* under *Email*.

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

### Past versions of lesson and activity files

Uploading a file over one of the same name renames the old copy to `<base>_<DD-MM-YYYY_HH-MM-SS><.ext>` (`uploadFile` in `src/lib/storage/local-storage.ts`). A stamped file is a **past version** only when its un-stamped name is in the same folder; one whose current copy has gone is an ordinary file and always shows. The rule lives once in `src/lib/storage/file-versions.ts` (`currentFileName`, `pastVersionNames`). `listLessonFilesAction`, `listActivityFilesAction` and the lesson detail snapshot's `lessonFiles` carry `past_version`. Teacher file lists hide past versions behind a *Show past versions (n)* switch (`PastVersionsSwitch`, shown only when there are any); pupil pages, presentations and the activity zip show current versions only. Pupil submission listings do not use the rule. MCP `list_lesson_files` lists everything. Tests: `tests/storage/file-versions.check.ts`.

## Key Data Contracts

**Assignment Data Flow**:
- `/assignments` hydrates via `assignments_bootstrap` RPC (call through `readAssignmentsBootstrapAction`)
- Lesson averages computed via `lesson_assignment_score_summaries` RPC
- Extend RPCs for new data needs rather than adding separate queries

**Pupil Lessons**:
- Teacher summary: `pupil_lessons_summary_bootstrap(p_target_user_id)` via `readPupilLessonsSummaryBootstrapAction`
- Pupil detail: `pupil_lessons_detail_bootstrap(p_target_user_id)` via `readPupilLessonsDetailBootstrapAction`
- Always shape JSON on Next.js server, never expose raw RPC payloads to clients
- **Page or Slides.** Each user picks how `/pupil-lessons/[pupilId]/lessons/[lessonId]` is laid out with the switch at the top of the lesson (or on their profile): `profiles.lesson_view_mode` `'page' | 'slides'` (migration 138), loaded as `profile.lessonViewMode` and set by `setLessonViewModeAction` (own profile only). The viewer's choice is used, so a teacher previewing sees their own. Page is the article; Slides puts each activity on its own full screen that fades in on scroll (`ActivityMotion`, `LessonHero`, `StickySectionHeading`, `LessonScrollProgress` in `lesson-scroll-layout.tsx`) with `ActivitySidebar`. Both render the same `renderActivity` output, so a new activity type only needs adding there.

**Public Lessons**:
- `lessons.is_public boolean DEFAULT false NOT NULL` — controls unauthenticated visibility
- `readPublicLessonsAction()` — returns all public lessons grouped by curriculum/unit (no auth required)
- `readPublicLessonActivitiesAction(lessonId)` — returns only `PUBLIC_ACTIVITY_TYPES` activities for a public lesson
- `toggleLessonPublicAction(lessonId, isPublic)` — teacher-only toggle; revalidates both the lesson page and `/signin`
- `PUBLIC_ACTIVITY_TYPES` in `src/dino.config.ts` — static display types only (`text`, `display-image`, `show-video`, `display-section`, `display-flashcards`); scorable and interactive types are hidden from public view
- `/signin` is the public lesson browser — split layout: scrollable left panel (hero + filter chips + unit cards), fixed right panel (sign-in form)
- Direct lesson links (`/lessons/[id]`) work without auth for public lessons; private lessons redirect to `/signin?returnTo=…`
- Unit page (`/units/[id]`) shows a globe icon on every lesson — green = public, grey = private; clicking the icon toggles `is_public`

**Report Levels**: Levels follow the school's Grade Boundary Calculator. Each year group has a top level (Year 7 5M, 8 6M, 9 7M, 10 8H, 11 9H), set by an admin at `/admin/levels` and stored in `year_group_levels.top_level` (migrations 121–122). The calculator numbers 0, 1L, 1M, 1H, 2L … up to the top level as steps 0..N; step *i* starts at *i* / (N + 1) of the marks, rounded to a whole percent, so the top level starts one step below 100%. The lowest level awarded is 1L: a score below 1L's boundary is still 1L, never 0. Read the levels with `readYearGroupLevels()` (`src/lib/levels/store.ts`) on the server and pass them to `getLevelForYearScore` (`src/lib/levels/index.ts`). Never hardcode level boundaries. The calculator spreadsheet's Year 7 cells 1L–2L divide by Year 8's step count; that is a bug in the sheet, and DINO uses the rule (13, 20, 27 for 1M, 1H, 2L). These are not `success_criteria.level`, which is a criterion's own attainment level.

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
| `surface:assessment-read` | the read of each assessment paper script before it is marked |
| `surface:assessment-mark-scheme` | splitting an assessment paper's mark scheme PDF by question |
| `surface:assessment-mark-text` | marking an assessment paper answer the reader read as text (with its page images) |
| `surface:powerpoint-mark-text` | marking a PowerPoint assessment question whose evidence sends no pictures (report, typed text, reference file) |
| `surface:database-mark-text` | marking a database assessment question whose evidence sends no pictures (report, typed text, reference file) |

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
`external_jobs` row each, one model call each, assessed independently. An
activity **without** criteria is not sent for marking at all (it does not count
towards progress, migration 129); `enqueueMarkingTasks` clears its status.

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
  `legacy` rows are derived, not real assessment: migrated from the old uniform
  fill, or filled in by DINO (a pupil's other criteria at 0 when a teacher marks
  one, marks carried over when criteria are linked later). A re-mark replaces
  them. Changing a criterion's type or levels moves stored marks with
  `refresh_criterion_marks` (migration 130): full stays full, anything else is
  capped below the new full mark.
- **Teacher marks and comments always override.** `effectiveCriterionFeedback`
  in `aggregate-sc-marks.ts` is the single rule: a teacher's comment wins; if
  the teacher changed the mark without commenting, the AI's comment is
  suppressed rather than left contradicting the new mark.
- The prompt must state that **0 is a valid score**. Without it the model
  anchors to the lowest descriptor and silently inflates every mark.

### Upload File marked by AI

An `upload-file` is teacher-marked unless its **Mark with AI** switch is on
(`body_data.aiMarking`, with the switch's *Marking prompt* in
`body_data.markingGuidance`; migration 142 routes it like `upload-code`). The
editor and MCP (`ai_marking`, `marking_prompt`) refuse the switch without a
prompt; old bodies without either still parse (`UploadFileActivityBodySchema`).
On, every upload (pupil or teacher dropzone, `/api/pupil-submission/upload`)
goes through `enqueueMarkingTasks`, one job per criterion as usual, and drops
the queued jobs of the pupil's earlier attempts. The route takes the client's
`groupAssignmentId` only when it names the activity's lesson and a class the
pupil is in, otherwise `self__study`. The pupil's **current** files
(a replaced file is a past version, `file-versions.ts`) go to the model:
images (png, jpeg, webp, gif) and PDFs as attachments, text files (txt, csv,
md, py, html, css, js, json) in the prompt (`src/lib/ai/upload-file-marking.ts`,
with size caps). Files of any other type are skipped and named in the prompt
as not shown, so the model marks only what it sees and flags the rest. When no
current file is readable, no model is called: the submission is set to
`marking-error` with *AI can't read .docx files; mark this yourself.*, at
enqueue and again, as a permanent error, in the worker. Anything
that acts on an activity rather than listing the AI-marked types must ask
`isAiMarkedActivity(type, body_data)`, not `isAiMarkedActivityType`, or every
upload-file is treated as AI-marked. Tests: `tests/upload-file/ai-marking.check.ts`.

### Assessment paper marking

**Stand-alone assessment papers are retired.** `ASSESSMENT_PAPERS_ENABLED` in `src/dino.config.ts` is `false`: the *Assessments* and *My Assessments* menu links are hidden and the stand-alone paper MCP tools (`list_assessment_papers`, `create_assessment_paper`, `record_assessment_paper_result`, `*_assessment_paper_file*` …) are not registered. The pages, code and tables are kept. Everything below is the assessment-paper **activity**, which the flag does not touch.


An `assessment-paper` is **read once, then marked per question** (Marking v2).
Sending a script queues one `ai_read` job `{submissionId, assignmentId}`
(`enqueueMarkingTasks`, from `storeScript` or *Send N unmarked scripts*;
over MCP a script link with `remark: false` stores and clears without
sending, and a question paper or mark scheme link may re-mark with `remark` /
`remark_questions`, see *PowerPoint assessments* MCP). The
read (`src/lib/assessment-paper/reading.ts`, route `surface:assessment-read`,
migration 135) sends the question list and the markable pages, each labelled
with its page number, and gets back per label `{kind: text|sketch|mixed,
transcription, pages, status: answered|blank|unreadable|continued}`; sketches
are described. `completeAssessmentRead` (store.ts) stores these in
`submission_question_answers` (a teacher-edited answer is never overwritten),
then under the submission's row lock: a blank answer scores 0 on every
criterion with "No answer submitted"; `activity_questions.marking = 'teacher'`
is left for the teacher; a question with no `mark_scheme` text is held and
named in `mark_error`; a question every criterion of which a teacher has marked
is not re-sent; every other question gets one `ai_mark` job `{submissionId,
assignmentId, questionId}`. The mark (`src/lib/assessment-paper/marking.ts`,
route `(assessment-paper, NULL)`) sends that question, its mark scheme, its
criteria with allocations, the transcription and the answer's pages (all pages
when unreadable), plus the earlier answer when `depends_on_question_id` is set;
the reply has every criterion exactly once, 0..allocation, or it throws and
retries. **The mark scheme is the only standard**: the prompt gives the
criteria as places to file the marks (topic + allocation), never as things to
mark against, and the comments must name mark scheme points, not criteria. `completeAssessmentQuestionMark` writes the rows (never over a
teacher's), closes the job and, when no sibling `ai_read`/`ai_mark` job is
open, sets `mark_status = 'marked'`. The worker claims both job types; the
generic `external_jobs` worker must exclude both. `recordCriterionMark` throws
for this type.

The model sees the script's **markable pages only** (pages 2..n), loaded by
`readMarkablePages` (`src/lib/assessment-paper/files.ts`), the sole loader a
model call may use — never read `original_path` or page 1 for a model.

On the results page a teacher can edit any transcription (stamped `teacher`),
any criterion mark and comment; a question is flagged **Check** when the model
marked it and it is `ai_check`, read as a sketch, or unreadable (and not
teacher-only); *Confirm* stamps its rows `teacher` without changing them
(`confirmAssessmentQuestionMarks`). A teacher's change of mark drops the
marker's comment on that row; an unchanged or confirmed mark keeps it
(`effectiveQuestionCriterionFeedback`).

**Page 1 is the front sheet and never reaches a model** (Marking v2, migration
134). Every paper starts with a front sheet, the only place a pupil writes
their name; the question paper's page 1 is the blank one. On upload
(`storeScript`) a script (PDF only) is rasterised, and its page 1 is compared
with the question paper's page 1 on the server, with no model
(`src/lib/assessment-paper/front-sheet.ts`: small greyscale thumbnails, mean
absolute difference under a calibrated threshold), along with the page counts.
Passed: pages 2..n are stored as `assessment_scripts.page_paths` and
`front_sheet_check = 'passed'`. Failed, or no question paper: no pages are
stored, `front_sheet_check` holds the reason and the submission is held
(`mark_status = null`, the reason in `mark_error`), nothing queued.
`readMarkablePages` refuses anything but a passed script and any path that is
not `page-N.png` with N ≥ 2. *Send N unmarked scripts* queues only passed scripts
with no question, criterion or answer rows of any provenance and no open job,
and never a folded paper (`body_data.foldedFromAssessmentIds`); the queue
refuses folded papers too.

**Per-question mark schemes** (Marking v2 §5, migration 136). *Split the mark
scheme by question* in the lesson editor, or MCP
`split_assessment_activity_mark_scheme`, sends the paper's mark scheme PDF (a
paper file, no pupil data, read only via `readMarkSchemePdf`) and the question
list to route `surface:assessment-mark-scheme`, and returns a proposal per
question beside its current text (`src/lib/assessment-paper/mark-scheme-split.ts`;
the reply must name every label once and no others). **It saves nothing**: the
teacher accepts per question or all, then saves through
`setAssessmentQuestions`. A question held for want of a mark scheme stays held
until *Send held questions* (`sendHeldAssessmentQuestionsAction`), which queues
one `ai_mark` job per question that now has mark scheme text, on latest
submissions whose read is complete and whose newest script passed, where the
question is not teacher-only, not blank, has no AI or teacher rows and no open
job (`listHeldQuestionsToSend` / `queueHeldAssessmentQuestions`, store.ts),
never on a folded paper. *Send N unmarked scripts* does not do this: it only
picks scripts with no rows at all.

Over MCP, `set_assessment_activity_questions` takes `marking` and `depends_on`
(an earlier label) per question, both kept when omitted; its input schema is
`AssessmentActivityQuestionsInput` in `src/lib/mcp/assessment-activities.ts`.
Its `remark` (default true) re-marks the questions whose `mark_scheme` text
changed on latest submissions whose read is complete, through
`listQuestionsToRemark` / `remarkAssessmentQuestions` (store.ts): not
teacher-only, blank, fully teacher-marked or folded; the marker's and legacy
rows go, teacher rows and a teacher's comment stay, a waiting job is left and
a running one replaced, and the result's `remarking` counts what was queued.
`remark: false` saves only. Tests: `tests/assessment-paper/mark-scheme-remark.check.ts`.
`get_assessment_activity` reports each pupil's read/mark progress and
`get_assessment_activity_result` each question's answer as read. Tests:
`tests/assessment-paper/mark-scheme-split.check.ts`.

MCP `set_assessment_activity_question_marks` marks one question (label or id)
on a pupil's latest submission as the results page does, through the same
store functions: a corrected transcription, then per criterion marks and/or a
comment, then *Confirm*. Every input is checked before anything is written.
MCP `create_assessment_activity_script_download_link` returns a one-time link
(`kind = 'assessment_script'`, `script_id`, migration 140) to the pupil's
newest script on their latest submission, the original PDF with its front
sheet, held or not: a teacher copy that no model sees. A replacement upload
deletes the script row and the link with it (`ON DELETE CASCADE`). Tests:
`tests/assessment-paper/question-marks-mcp.check.ts`.

MCP `remark_assessment_activity` (any question-marked type) reads and marks
again pupils' latest submissions (or `pupil_ids`; `dry_run` changes nothing):
handed in (practical) or a passed newest script (paper), no `ai_read` open, not
every question teacher-marked; never a folded paper. Under the row lock
(`clearForReread`, store.ts) open read/mark jobs go and
`clearMarkedQuestionWork` clears the marker's rows and the reader's answers
(teacher rows, a teacher's comment and, on a paper, a teacher's transcription
stay), then `enqueueMarkingTasks` queues a fresh read, which picks up a new
reader version. Flags are left alone. `questions` (labels; all must exist,
not be teacher-only and have mark scheme text, or the call is refused) limits
it to those questions: on a practical type the files **are read again** but
only those questions change (`clearForReread`'s `questionIds`, the `ai_read`
payload's `questionIds`, which `completeAssessmentRead` obeys); on a paper the
script is **not read again** and the questions are re-marked from the stored
transcriptions (`remarkAssessmentQuestions`). Code `src/lib/assessment-paper/remark-activity.ts`;
tests `tests/assessment-paper/remark-activity.check.ts`.

**A mark request is never paid for twice** (migration 151,
`src/lib/assessment-paper/mark-reuse.ts`). Both markers (`markAssessmentQuestion`,
`markPowerPointQuestion`) fingerprint the request just before the call: sha256
of provider, model, effort, system text, response schema, `maxTokens`, every
part in order (text verbatim, an attachment by mime type + sha256 of its
bytes), the criteria ids and allocations, and `MARK_REUSE_VERSION` (bump it
when reply handling changes). `submission_question_mark_requests` keeps one
row per submission and question, the latest answered request: its hash and
the validated result (rows, the practical marker's evidence note, a hold).
`completeAssessmentQuestionMark` writes it in the transaction that applies the
result, so a superseded job or a failed apply stores nothing. A mark job whose
hash matches turns the stored result back into a reply and runs it through the
same checks and apply as a fresh one (teacher rows kept, `ai_awarded`, holds),
with no model call; the job row says `reused: true`. Clears and re-marks
(`clearMarkedQuestionWork`, `clearForReread`, *Undo hand in*, a file change)
leave the row alone: that is the point. Only `remark_assessment_activity`
`force: true` deletes it. A new attempt is a new submission, so nothing carries
across attempts. A paper read again in full gets a fresh call when the reader's
transcription comes back worded differently. Tests:
`tests/assessment-paper/mark-reuse.check.ts`.

**Practical marking uses the Anthropic prompt cache.** A `ModelPart` text part
may carry `cache: true` and a `ModelRequest` `cacheSystem`; the Anthropic
transport turns them into `cache_control: {type: "ephemeral"}` (5-minute TTL)
and refuses more than 4 per request (`buildClaudeMessageParams`, which builds
the request body without a network call, for a future Message Batches path
too); Gemini drops them. The flags are not in the mark-reuse fingerprint
(text and order only). The practical marker (`markPowerPointQuestion`) sends
the system text (a breakpoint, shared by every question of the type), then
the pupil's report sections **before** anything question-specific
(`reportParts`): per report a heading, then one part per group, a
presentation's in the order slides, layouts, masters, the rest, a database's
one per section; a breakpoint ends each group when there are at most 3, else
the first two and the last. The question's evidence list then says which
parts of the report above are its evidence (`… slides:3: given above`). A
pupil's questions with the same sections send byte-identical parts, and sets
that start alike share their first groups. The worker staggers one hand-in's
practical mark jobs in a batch (`src/lib/ai/cache-warm-order.ts`): each starts
once the previous one's response has begun (the Anthropic transport streams
the reply for such a caller and signals at the first event,
`model-call-started.ts`; Gemini signals at once), or it finished, or 30 s
passed, because a cache entry is readable only from then. A prefix shorter
than the model's minimum (Sonnet 5 1024 tokens, Opus 5 512, Haiku 4.5 4096) is
simply not cached. The reorder changed every practical request's text, so each
question's first mark after this change is a fresh call, not a reuse. The
paper marker is unchanged. `model_request.cacheBreakpoints` and the report
sections in `textSections` (`report:<kind>:<slot>:<section>`) are on the job
row. Tests: `tests/powerpoint-assessment/prompt-cache.check.ts`.

**Message Batches for question marking** (migration 152,
`src/lib/ai/message-batches.ts`). A route row's *Batch* switch at
`/admin/ai-models` (`ai_model_routes.use_batch`, on by default, "half price,
results can take up to 24 hours") sends a job by the Anthropic Message
Batches API instead of a direct call. It has effect only on `BATCH_ROUTE_KEYS`
(`model-routing.ts`: the three question-marked types and
`surface:assessment-read` / `-mark-text` surfaces) with provider `anthropic`;
`setAiModelRouteBatchAction` refuses anything else, and a row moved off
anthropic turns it off. So only a question's `ai_mark` and a paper's `ai_read`
go by batch, never STQ, upload-*, worksheets, chat, OCR or the mark-scheme
split. The route that chose the model decides (question model → text route →
activity route; a question's own `marking_model` takes the activity route's
switch). Each marker is split into prepare (`markAssessmentQuestion`,
`markPowerPointQuestion`, `readAssessmentScript`, with a `park` hook) and
handle reply (`finishAssessmentQuestionMark`, `finishPowerPointQuestionMark`,
`finishAssessmentRead`), so a batch reply gets the same checks, hold rule,
mark-reuse row and apply as a direct one. Mark reuse comes first: a reused
mark is never parked. A parked job keeps `status = 'processing'` with a
`model_batch_items` row (the full `buildClaudeMessageParams` body, cache flags
kept, and the handler's JSON context): the claim takes only `pending`,
`recoverStuckItems` skips a job with an item, and every path that deletes or
closes open jobs (re-mark, *Undo hand in*, a file change, a hold) works
unchanged; a deleted job deletes its item (cascade), and a result whose item
has gone or whose job is no longer `processing` is dropped. `runBatchTick`
(`marking-queue.ts`) releases overdue items (unsent 30 min, sent 25 h), submits
every parked item (custom_id = job id; ≤ 100,000 requests / 256 MB per batch)
and polls each open batch at most once per 55 s; ended results run through
`processSingleItem` with `options.batch` (`succeeded`), or go back to the
direct path (`errored` / `expired` / `canceled`: `pending` now, attempts
unchanged). A job that left a batch carries `payload.directOnly`, so its
retries are direct calls. The job row records `model_request.batch: {id,
submittedAt}` and `model_response.usage`. The tick is driven by
`startBatchDriver` (`src/lib/ai/batch-driver.ts`), started from
`src/instrumentation.ts` in each server process: once a minute while batch
work is open, then `triggerQueueProcessor` when results came back. No cron.
The stagger does not apply to batch items. MCP `get_assessment_activity`
reports `progress.batch: {jobs, status: to_send | sent}`. Tests:
`tests/assessment-paper/batch-marking.check.ts`.

`submission_question_criterion_marks.ai_awarded` (migration 141) keeps the
marker's own mark: every AI write sets it, a teacher's write (mark, comment,
confirm, transcription) never touches it, and the marker never writes over a
teacher's row, so it is null on rows the AI never marked (teacher-only, or the
teacher marked first). The migration backfilled it from finished `ai_mark` jobs'
`model_response.criteria`, teacher rows still carrying the marker's comment,
and blank answers. `summariseTeacherChanges` (results.ts) turns it into AI
mark / final mark / change. **Teacher copy only**: the class feedback PDF
passes `teacherCopy` to `readAssessmentFeedbackPdfData` and MCP
`get_assessment_activity_result` returns `ai_awarded`; no pupil view or pupil
PDF shows it.

MCP `create_assessment_activity_class_feedback_link` (class, unit, activity by
id or exact name) returns a one-time `mcp_download_links` link
(`kind = 'assessment_class_feedback'`, migration 137) to one PDF of a class's
feedback: a cover with every pupil's latest marks, % and status; a
pupil-by-question grid (cells coloured full / partial / attempted, no marks /
did not attempt, with a *% correct* row); a question analysis (a 100% bar per
question in the same four colours); then each sat pupil's own feedback pages,
built on download (`src/lib/assessment-paper/class-feedback-pdf.ts`). The four
categories come from one rule, `questionOutcome` (results.ts). Teacher copy:
feedback visibility does not apply. Tests: `tests/assessment-paper/class-feedback.check.ts`.

### PowerPoint assessments

A `powerpoint-assessment` (migration 143) is a practical task marked like an
assessment paper: it is in `QUESTION_MARKED_ACTIVITY_TYPES`, so questions,
per-criterion marks, `ai_awarded`, Check/Confirm, results and feedback PDFs are
the paper's machinery (`src/lib/assessment-paper/store.ts`). Only the hand-in,
the read and the mark are its own (`src/lib/powerpoint-assessment/`). Test the
type with `isPowerPointAssessmentType` / `isAssessmentPaperType`, never
`isQuestionMarkedActivityType`, wherever scripts or files are involved. It is
the generic **PowerPoint** flow: nothing in code knows a particular paper;
slots, headings, sections and images are the teacher's data.

**Practical types share this machinery** (`PRACTICAL_ASSESSMENT_TYPES` =
`powerpoint-assessment`, `database-assessment`; see *Database assessments*).
Files, slots, hand-in, *Undo hand in*, Request Resubmission, read/mark jobs,
results, pupil view, feedback and MCP in `src/lib/powerpoint-assessment/`
serve both; the modules and exported names (`storePracticalFile`,
`handInPowerPointAssessment`, `reopenPowerPointAssessment`, result/MCP field
`powerpoint`, MCP `hand_in_powerpoint_assessment`) keep their PowerPoint names.
What differs is data in the registry `src/lib/practical-assessment/types.ts`
(`PRACTICAL_TYPE_CONFIGS` / `practicalTypeConfig(type)`: label, body schema,
slot kinds, main kind, allowed evidence sources, default body,
`hasSuppliedImages`, `hasStartingDatabase`) plus per-type marking text
(`MARK_TEXT` in `marking.ts`). The reader and marker branch on **slot kind**
(`pptx`, `accdb`, `pdf`, `docx`), never type. Test with
`isPracticalAssessmentType` for anything generic, `isPowerPointAssessmentType`
/ `isDatabaseAssessmentType` only for the type-specific parts (supplied images
and slide rendering are PowerPoint-only). `validateQuestionEvidence(questions,
body, type)` and `practicalBodyProblem(body, type)` take the type. Further file
types (spreadsheets …) are new registry entries and slot-kind readers.

- **Upload slots** (`body_data.uploadSlots`, `PowerPointAssessmentActivityBodySchema`):
  1–8, exactly one `pptx` slot (the presentation, required); `pdf` printouts
  and a `docx` evidence document are supporting. One file per slot per
  submission (`practical_submission_files`, assessment-scripts bucket,
  `{activityId}/practical/{fileId}/original.*`), checked on upload
  (`checkSlotFile`: `.ppt`, `.doc`, a password or a damaged file refused with
  the reader's message). *Hand in* (refused while a required slot is empty)
  sets `submission_status = 'submitted'` and queues the read: marking starts
  on hand-in. After it a pupil cannot change files; a teacher can, which
  clears the AI marks (teacher rows kept) and re-queues after 120 s. A
  teacher's *Undo hand in* in the results panel (`reopenPowerPointAssessment`,
  `reopenPowerPointAssessmentAction`) sets the work back to `inprogress` on the
  same attempt: files kept, open read/mark jobs dropped, AI marks cleared
  (teacher rows kept), open question flags cleared as that teacher; the pupil
  can change files and hand in again (any practical type). **Request
  Resubmission** on a practical assessment does the same (`requestResubmissionAction`, through
  `reopenPowerPointAssessmentForTeacher` in `reopen.ts`); the pupil sees the
  teacher's note above their slots, and handing in clears the request.
- **Supplied images** (`practical_supplied_images`, lessons bucket, generated
  file names) are fingerprinted (`src/lib/pptx/known-images.ts`) so the
  inspector names them in a pupil's slides; a likeness of
  `MATCH_THRESHOLD_PERCENT` (72%) counts as a match, and an upload that close
  to another supplied image is warned about.
- **Evidence sources** (`activity_questions.evidence`, `evidence-spec.ts`,
  checked by `validateQuestionEvidence` in `setAssessmentQuestions`):
  `presentation` (report sections: `presentation`, `master`, `layouts`,
  `slides`, `slides:3,6`, `action-buttons`, `notes`, `supplied-images`,
  `media`, `warnings`; default all but media; `PRESENTATION_SECTION_KEYS`
  mirrors `describe.ts`), `slide_images`, `file` (a PDF attached whole),
  `evidence_section` (a `.docx` heading; `want` screenshots/text/both) and
  `reference_file` (an activity file's text, never a question's only source).
- **Read** (`ai_read`, `reading.ts`, no model): pptx by the inspector
  (`inspectPptx` + `describePresentationSections`); the EVIDENCE `.docx` by
  heading (`src/lib/docx/evidence.ts`: a heading is a paragraph starting with
  the label; the blank template's paragraphs removed; a plain template
  heading no question names (label-shaped, e.g. "9  Create a report", not a
  sub-part of the current label) ends the section above it and what follows
  is *unplaced*; a docx's cache key carries `EVIDENCE_DOC_READER_VERSION`,
  bumped when this changes); pictures normalised and
  stored teacher-only under `evidence/`; pictures outside every heading kept
  as *unplaced*, never marked); PDFs by poppler (`src/lib/pdf/poppler.ts`:
  page count, text capped). A pptx some question reads as `slide_images` is
  drawn by LibreOffice via Gotenberg then `pdftoppm` (≤ 40 slides); if that
  fails the read records a warning and the marker is told, nothing is held.
  Each file's result is stored once per cache key (file sha256 + the reader's
  inputs, i.e. supplied images, headings, template, render version +
  `READER_VERSION`) in `practical_submission_evidence`. A file that cannot be
  read holds the **whole** submission (`mark_status` null, reason in
  `mark_error`).
  The presentation report gives every formatting value **effective**, with
  its source in brackets: title/text alignment and anchor, footer/date/slide
  number font, size, colour, b/i/u, shape and placeholder fills, resolved
  slide → layout → master → `txStyles` → `defaultTextStyle` → theme →
  PowerPoint's default (`[set on this slide]`, `[from master]`, `[default]`
  …); a value it cannot resolve is `UNKNOWN (reader could not resolve)`,
  never left out (`powerpoint-reader-2`; tests `tests/pptx/effective-format.check.ts`,
  fixtures from `tests/fixtures/pptx/generate-reader-fixtures.py`).
- **Blank**: a `required` source missing, or no source with anything, is
  blank → 0 with no model call; the comment is the reader's reason ("You did
  not hand in …", "Slide 6 is not in your presentation.", "There is no 1j
  section in your …") or "No answer submitted". **A missing required
  screenshot is always 0** (teacher decision); unplaced pictures never stand
  in for it. A required heading holding only pictures DINO cannot show (EMF,
  WMF …) is not blank: the question is held for the teacher, named, never
  sent.
- **Mark** (`ai_mark` per question, `marking.ts`, route
  `('powerpoint-assessment', NULL)`): the model gets that question's own
  sources only, under caps (10 images, 3 PDFs, 20 MB, 60 000 chars;
  overflow is a permanent error naming the question). `POWERPOINT_MARK_SYSTEM`:
  the mark scheme is the only standard and criteria are filing labels; report
  facts are exact, screenshots count only when readable, never infer an
  unseen setting; every comment names its slide, file or heading; never the
  pupil's name. The reply's `evidence_note` is stored as
  `submission_question_answers.marker_evidence`: **teacher-only**, like
  `ai_awarded`. A part needing a value the report gives as UNKNOWN is not
  given 0: the marker replies `hold_for_teacher: {reason}`, and
  `completeAssessmentQuestionMark` holds it like an EMF screenshot (no AI
  rows, teacher rows kept, answer `unreadable` with the reason, named in
  `mark_error`, *Check* in the results panel). A reason such as "None" or
  "N/A" (`isNotAHoldReason`) is dropped when the reply marks every criterion
  (Haiku did this); with no valid criteria it stays a hold. Tests:
  `tests/powerpoint-assessment/hold-for-teacher.check.ts`.
- **Privacy**: no pupil file name reaches a model, a job row or
  `ai_marking_logs` (slot label + file id + extension instead; the upload
  link's audit row logs only the extension). Pupils never get the mark scheme
  PDF (`showMarkSchemeToPupils` only governs the feedback PDF's per-question
  text). A locked lesson blocks a pupil's uploads, hand-in and downloads,
  never staff's.
- **Download names**: a pupil's own assessment file downloads as
  `<First> <Last> - <name>` (`pupilDownloadFileName`, `src/lib/storage/pupil-file-name.ts`;
  not doubled, unchanged with no name): practical files with their uploaded
  name, scripts (`/api/files` and the MCP script link) as `<pupil> - <activity title>.pdf`,
  the pupil's feedback PDF. `pupilFileDownloadName` (assessment-paper/files.ts)
  looks it up for `/api/files`. A practical assessment's own files (activity
  files such as the evidence template and starting database, supplied images,
  the question paper) download as `<lesson title> <name>` (`lessonDownloadFileName`;
  `practicalActivityFileDownloadName` for `/api/files`, `downloadName` in the
  pupil view). Tests: `tests/powerpoint-assessment/download-names.check.ts`.
- **Views**: the results panel shows *Pupil's files* (reader status, missing
  headings, warnings, unplaced pictures), each question's evidence and
  screenshots, the marker's note, and a teacher *Hand in*. The pupil's
  activity (`pupil-powerpoint-assessment-activity.tsx`, `pupil-view.ts`) has
  the downloads, a dropzone per slot and *Hand in*, then per-task feedback
  once released, never `ai_awarded` or `marker_evidence`.
- **MCP**: `set_assessment_activity_questions` takes `evidence`;
  `get_assessment_activity` / `get_assessment_activity_result` report slots,
  files, hand-in and the marker's note; `create_assessment_activity_file_upload_link`
  kinds `supplied_image` (10 MB), `practical_file` (pupil + slot, 25 MB,
  does not hand in), and (migration 147, either practical type)
  `evidence_template` (.docx) and `reference_file` (`file_name` required, the
  evidence's `fileName`; pdf, docx, txt, md, csv, 5 MB), stored as activity
  files (`src/lib/practical-assessment/activity-files.ts`, past versions kept)
  with the template set in `body_data`. The link's `remark` / `remark_questions`
  re-mark after the upload (`remarkAssessmentActivity`): whole-activity kinds
  default to none; a pupil's file defaults to the usual re-send, `remark: false`
  stores and clears (`storePracticalFile` `afterChange: 'clear'`, `storeScript`
  `send: false`), `remark_questions` re-marks only that pupil's named questions
  (`afterChange: 'keep'`); the result is in the upload's reply and never undoes
  the file (tests `tests/powerpoint-assessment/upload-link-kinds.check.ts`);
  `get_practical_assessment_evidence` (what the reader
  stored, no picture data); `hand_in_powerpoint_assessment` (either practical
  type). The script link is refused for practical types. See `docs/MCP.md`.
- **Migration 143**: the type in `is_question_marked_activity_type` and
  `is_scorable_activity_type`, `activity_questions.evidence`,
  `practical_supplied_images`, `practical_submission_files`,
  `practical_submission_evidence`, `submission_question_answers.marker_evidence`,
  `mcp_upload_links.slot_key` with the two upload kinds, and the route row.
- **Copying old Upload File work in**: `scripts/copy-uploads-to-powerpoint-assessment.sh <scripts/powerpoint-mappings/x.json> [--apply] [--hand-in] [--replace] [--fallback-root <dir>]` (dry run by default; the mapping says which source activity's files fill which slot by extension and `name_contains`). Latest attempt, current files only, stored through `storePracticalFile` as a teacher; filled slots and handed-in pupils are left alone unless `--replace`; `--hand-in` queues real marking and asks first. Results in `powerpoint-copy-results/` (gitignored, has pupils' file names). The mapping names its target by `target: {lesson_id, title}` (or `target_activity_id`).
- **Setting one up from a spec**: `scripts/setup-powerpoint-assessment.sh scripts/powerpoint-assessments/*.json [--apply] [--copy [--hand-in]]` creates the activity (slots, supplied images and files from the lesson's data activity, papers, questions with mark scheme rows, criteria and evidence) by lesson and title, idempotently; questions are never rewritten once set. Specs exist for the three 6.5 Presentation lessons (Starlight practice A, Pearl practice B, Horizon assessment).
- Tests: `tests/powerpoint-assessment/*.check.ts` (questions, evidence-doc,
  files, reading, read-guards, blank-reasons, marking, results, pupil-view,
  editor, mcp), plus `tests/pptx/inspect.check.ts`.

### Database assessments

A `database-assessment` (migration 146) is the second practical type: a
Microsoft Access `.accdb` plus an EVIDENCE `.docx` (screenshots and typed
answers under headings), marked per question exactly as a PowerPoint
assessment, on the same tables, jobs, views and MCP tools. Only the parts
below differ.

- **Slots** (`DatabaseAssessmentActivityBodySchema`, kinds `accdb`/`pdf`/`docx`):
  1–8, exactly one `accdb` slot, required; default body `database` +
  `evidence`. No supplied images, no `presentation`/`slide_images` sources.
- **Starting database**: `body_data.startingDatabaseFile`, an ordinary
  activity file (`.accdb`, no folders), like `evidenceTemplateFile`. Pupils
  download it; each pupil's database is diffed against it; its sha256 is in
  the accdb cache key. The editor checks it with `checkStartingDatabaseAction`
  (`checkActivityStartingDatabase`, `powerpoint-assessment/editor.ts`). A
  missing or unreadable starting database is a warning (changes not listed),
  never a hold.
- **Reader** (`src/lib/accdb/`, no model): `mdbtools.ts` runs `mdb-ver`,
  `mdb-tables`, `mdb-schema`, `mdb-prop`, `mdb-json`, `mdb-queries` by
  `execFile` on a temp copy in its own `mkdtemp` dir (30 s per tool, 16 MB
  output, 120 s per read). `read.ts` (`readAccessDatabase`) checks the header
  first (`sniffAccessHeader`: "Standard ACE DB"), then builds a
  `DatabaseSnapshot` (`types.ts`): tables, fields, lookups, saved sort/filter,
  records (≤ 1000 per table, dates DD-MM-YYYY), relationships (referential
  integrity from DAO `grbit & 2` = not enforced), saved query designs, forms
  and reports with their base table where recorded. Form/report **design is
  not decoded**. `diff.ts` (`diffDatabases`, records matched by each table's
  first field). `describe.ts` (`describeDatabaseSections`, `filterDatabaseSections`;
  ≤ 200 records shown per table; query criteria dates keep Access's
  `#m/d/yyyy#` with the date in words). Upload runs the light
  `checkAccessDatabase` (`check.ts`). `UnreadableDatabaseError` /
  `DATABASE_MESSAGES` (`errors.ts`): `.mdb`, `.laccdb`, not Access, and one
  combined password-or-damaged message, refused at upload and holding the
  submission at read; a plain `Error` (tool missing, timeout) retries.
  Stored as `practical_submission_evidence.kind = 'database'`, cache key
  file sha256 + starting database hash + `DATABASE_READER_VERSION`.
- **`database` evidence source** (`{source, slot, sections?, required?}`,
  `section-selectors.ts`): `tables`, `fields`, `relationships`, `lookups`,
  `table-sort`, `records`, `records:TABLE`, `changes`, `queries`,
  `query:NAME`, `objects`, `warnings`; default all but records and single
  queries (`DEFAULT_DATABASE_SECTIONS`); names compared by `databaseNameKey`
  (case-insensitive). A `required` source naming a table/query the database
  lacks is blank ("There is no saved query called X in your database.").
- **Mark**: `DATABASE_MARK_SYSTEM` (`src/lib/database-assessment/marking-text.ts`,
  via `MARK_TEXT`): PowerPoint's rules, plus the report is exact and wins over
  a screenshot about what is in the database, it gives query designs never
  results, criteria dates are month-first, design is judged from screenshots
  only. Route `('database-assessment', NULL)`, seeded from PowerPoint's. The
  marker gets `slot_key.accdb`, never the pupil's file name. The "Name /
  Class" lines before the first heading are unplaced, teacher-only.
- **Views**: the results panel's *Pupil's files* adds what the reader found
  and the changes from the starting database (`DatabaseSummary`), and per
  question the report text the marker was given (teacher-only). MCP as in
  `docs/MCP.md` *Database assessment activities*; the starting database and
  the evidence template upload through `create_assessment_activity_file_upload_link`
  kinds `starting_database` / `evidence_template`, which store the activity file
  and set the `body_data` key (`starting_database` is refused on other types).
- **Runtime**: `mdbtools` is installed in the `Dockerfile-dino` runner (with
  poppler-utils). Prod needs migration 146 **and** an image rebuild.
- **Setup from a spec**: `scripts/setup-powerpoint-assessment.sh
  scripts/database-assessments/*.json [--apply]` (spec `"type":
  "database-assessment"`, `starting_database_file`, read in the dry run;
  `--copy` is PowerPoint-only). Spec: `palm-grove-vets.json` (68 one-mark
  questions).
- Tests: `tests/database-assessment/*.check.ts` (config, reader, describe,
  questions, evidence-doc, files, reading, marking, results, pupil-view,
  editor, mcp).

### Pupil feedback and per-question flags (all question-marked types)

All three pupil views (assessment paper, PowerPoint and database assessment) show feedback the
same way, through one component, `AssessmentQuestionFeedback`
(`src/components/pupil/assessment-question-feedback.tsx`). Its data comes from
one builder, `buildPupilAssessmentFeedback` (`src/lib/assessment-paper/pupil-feedback.ts`):
the total, the teacher's comment, the PDF, then per question the mark, the
effective comments and the pupil's flag. It never carries `ai_awarded`,
`marker_evidence`, the mark scheme, the transcription or `mark_error`. Each type
says which questions show their marks: both practical types use
`powerPointQuestionShownToPupil`; a paper shows a question once the paper is
`marked`, or earlier when a teacher (or legacy) mark is on it
(`assessmentPaperQuestionShownToPupil`). Both are released by
`pupilFeedbackVisible`. `readPupilAssessmentPaperView` lives in the same file.

The feedback PDF (`feedback-pdf.ts`, `assessment-paper-feedback-document.tsx`)
keeps the landscape table for a paper. A practical type is set out as its
question paper, A4 portrait: a heading per task from the leading part of each
label (`1a`, `1b` → *Task 1 – Master slide*, the title read by `pdftotext` from
the question paper's "Task 1 – … (n marks)" line, else *Task 1*; `S1`..`S5` →
*Section B*) with its subtotal, then per part `(a)` and the question text, a
green "n marks awarded", or "x of n marks awarded" with the lost criteria's
advice in red (`practicalPartMarks`), or grey *Not marked yet*. No answers,
mark scheme or transcriptions. The class PDF reads the titles once
(`readTaskTitles`, which never throws). Tests: `tests/powerpoint-assessment/feedback-pdf.check.ts`.

A pupil flags **one question** for their teacher to check
(`setAssessmentQuestionFlagAction`). It is refused, by `pupilQuestionFlagRefusal`,
unless it is their own latest attempt, feedback is released, the question shows
them a mark, and the lesson is not locked. It is refused for teachers.
`submission_question_flags` (migration 144) keeps one row per flag. At most one
is open per question. A flag ends `withdrawn_at` (the pupil unflagged it) or
`resolved_at` / `resolved_by` (a teacher cleared it). The question's marks are
snapshotted at flag and at resolve, and the outcome (changed / unchanged /
withdrawn) is **derived** from the snapshots (`flagOutcome`, `question-flags.ts`),
never stored. `submissions.is_flagged` is kept equal to "has an open question
flag", so the results grid's flag icon works unchanged. The grid's **Clear
flag** (`toggleSubmissionFlagAction` with `false`) resolves every open question
flag on the submission as that teacher. A pupil calling that action on a
question-marked activity is refused, and so is a teacher setting a flag. A new
attempt closes the earlier attempts' open flags as withdrawn (trigger
`submission_question_flags_close_earlier`). A practical (PowerPoint or
database) question cannot be flagged before hand-in. The results panel shows *Flagged by pupil*,
a *Clear flag* bar per question (`clearAssessmentQuestionFlagAction`) and each
question's flag history. MCP reports `flag` per question and `questions_flagged`
per pupil. Tests: `tests/assessment-paper/question-flags.check.ts`.

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

**Per question on question-marked types** (migration 148):
`activity_questions.marking_model` names a `MODEL_CATALOGUE` text model for
one question of an assessment paper, PowerPoint or database assessment; null
uses the activity's route as above. Set it in the lesson editor (*Marking
model*) or MCP `set_assessment_activity_questions` (`marking_model`, kept when
omitted, null clears). **Image comparison stays on a high-resolution vision
model**: `questionSendsImages(type, evidence)` (`src/lib/assessment-paper/question-model.ts`)
is true for every assessment-paper question and for a practical question with
a `slide_images`, `file` or `evidence_section` (want not `text`) source, and
then a standard-tier model (Haiku, Gemini Flash) is refused on save, the check
running on the question as saved. At mark time `resolveQuestionModelRoute`
(`question-model-route.ts`) uses the question's model only if it is still
allowed, else the activity route with a `warn` in `ai_marking_logs`. Tests:
`tests/assessment-paper/question-model.check.ts`.

**Text answers on a paper** (migration 149): with no question model, a
paper answer the reader stored as `kind = 'text'`, `status = 'answered'` is
marked on route `surface:assessment-mark-text` (seeded Claude Haiku 4.5, page
images still sent; an eval matched Sonnet on text answers); sketch, mixed,
unreadable and continued answers keep `(assessment-paper, NULL)`. So the
order is question model → text route → paper route. Without an active row for
that key (`findOwnModelRoute`, never `DEFAULT_ROUTE`), or naming a model that
is not an available catalogue text model (with a `warn`), it falls back to the
paper route. Only this question's own answer decides, never a `depends_on`
one. Practical types do not use this key (see below). The log's `modelSource` is `question`,
`text-answers` or `activity`; MCP `get_assessment_activity` reports
`text_answer_marking_model`. Tests:
`tests/assessment-paper/text-answer-route.check.ts`.

**Text-only questions on a practical type** (migration 150): with no
question model, a PowerPoint or database question whose evidence sends no
pictures (`questionSendsImages` false: `presentation`, `database`,
`reference_file`, `evidence_section` with want `text`) is marked on its
type's route, `surface:powerpoint-mark-text` (seeded Claude Haiku 4.5; an eval
matched Sonnet on PowerPoint) or `surface:database-mark-text` (**not seeded**:
database assessments stay on their activity route until an admin adds a row).
Questions with `slide_images`, `file` or screenshots keep the activity route.
So the order is question model → text-question route → activity route, by
`chooseQuestionModel` in `question-model-route.ts` (`textRouteSurface` picks
the key). No active row → the activity route (never `DEFAULT_ROUTE`); a row
naming a model that is not an available catalogue text model → the activity
route with a `warn`. The log's `modelSource` is `text-questions`; MCP
`get_assessment_activity`'s `effective_marking_model` includes it, and the
editor's *Activity default* label follows the question's evidence as it is
edited (setup `textQuestionMarkingModel`). Tests:
`tests/powerpoint-assessment/text-question-route.check.ts`.

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
feedback, raw reply truncated to 4 000 chars, and `usage`) and `duration_ms`.
`usage` (`src/lib/ai/model-usage.ts`) is the provider's own token count:
`inputTokens` (full rate), `outputTokens` (thinking included),
`cacheCreationInputTokens`, `cacheReadInputTokens`; Gemini's cached tokens are
taken out of `inputTokens`, and it has no write charge. `ai_read` rows of a
paper and chat log rows (`recordModelCall`) carry it too; null on a reused
mark. `callModel` / `callModelJson` return it.

**Base64 image data is deliberately not stored** — a worksheet request carries
several MB of it. Only `{fileName, mimeType, bytes}` per image is kept.

Completed `ai_mark` rows are no longer deleted on completion; they age out on
the generic 7-day sweep (`pruneDoneJobs`) along with every other job type.

```sql
-- slowest marking calls in the last day, with their tokens
select duration_ms,
       model_request->>'model'        as model,
       model_request->>'scType'       as sc_type,
       (model_response->>'marksAwarded')::int as awarded,
       (model_response->'usage'->>'inputTokens')::int              as input,
       (model_response->'usage'->>'cacheReadInputTokens')::int     as cache_read,
       (model_response->'usage'->>'cacheCreationInputTokens')::int as cache_write,
       (model_response->'usage'->>'outputTokens')::int             as output,
       payload->>'submissionId'       as submission
from external_jobs
where job_type = 'ai_mark' and model_request is not null
  and updated_at > now() - interval '1 day'
order by duration_ms desc
limit 20;

-- token totals per model in the last day (multiply by the model's rates:
-- cache reads 0.1x input, 5-minute cache writes 1.25x)
select model_request->>'model' as model, count(*) as calls,
       sum((model_response->'usage'->>'inputTokens')::bigint)              as input,
       sum((model_response->'usage'->>'cacheReadInputTokens')::bigint)     as cache_read,
       sum((model_response->'usage'->>'cacheCreationInputTokens')::bigint) as cache_write,
       sum((model_response->'usage'->>'outputTokens')::bigint)             as output
from external_jobs
where job_type in ('ai_mark', 'ai_read', 'chat') and model_response ? 'usage'
  and updated_at > now() - interval '1 day'
group by 1 order by 1;
```

Gather is concurrency-sensitive: `processNextQueueItem` runs a batch
concurrently (`runCacheStaggered`, like `Promise.allSettled`), so sibling
criterion results for one submission arrive together. `recordCriterionMark` takes `select … for update` on the submission
row before deciding whether the set is complete.

## Manual backup to the dev server

`/admin/backups` (admin only) has **Back up now and send to dev server**. The web
container has no Docker socket and no SSH key, and must not get them, so the
page only inserts a `backup_requests` row (migration 145; at most one pending or
running, by a partial unique index). `scripts/backup-on-request.sh`, run by the
**prod host's** cron every minute, claims it, runs `backup-db.sh manual`
(timestamped, encrypted dumps of dino + n8n in `backups/`, not pruned by that run
but covered by the daily 7-day prune) and `push-to-coding.sh dumps <timestamp>`
(only those dumps; waits up to 10 minutes for the hourly push's lock instead of
skipping), then records `done` with file names and sizes, or `error` with the
last lines of output. A request running for 30 minutes is marked as an error.
The page polls every 5 s while one is open and flags a request still pending
after 10 minutes, which means the cron line is missing. Code:
`src/lib/backups/store.ts`, `src/lib/server-actions/backups.ts`.
`BACKUP_REQUEST_SKIP_PUSH=1` skips the push, for trying it on dev.

One-time install on prod (after `scripts/migrate.sh` has applied 145):

```
* * * * * ~/planner-004/scripts/backup-on-request.sh >> ~/planner-004/backups/request.log 2>&1
```

## Email

DINO sends email by SMTP through the owner's Gmail account
(`src/lib/email/mailer.ts`, `nodemailer`). `sendEmail({to, subject, text, html?},
{purpose})` sends to **one** address and returns `{messageId}`; it throws
`EmailNotConfiguredError` (settings missing), `InvalidRecipientError` or
`EmailSendError`, whose message is plain and safe to show (bad password / App
Password needed, port blocked, host not found, daily limit) and built from
SMTP codes only. A send logs one `[email]` line with the recipient's domain,
the purpose and the result: never the address, the body or the password.
`emailConfigStatus()` reports the settings without the password. Port 465 uses
SSL; any other port must upgrade with STARTTLS (`requireTLS`), so nothing is
sent in clear. Timeouts are 15 s (connect, greeting) and 20 s (socket), so a
blocked port fails fast.

Settings, all in `.env`, all optional (the app boots without them; not in
`required-env.ts`); restart the app after a change:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587            # default 587
SMTP_USER=               # the full Gmail address
SMTP_PASSWORD=           # a Gmail App Password, not the account password
MAIL_FROM=               # default "DINO <SMTP_USER>"
```

Gmail App Password: turn on 2-Step Verification on the account (Google
Account > Security), then Security > 2-Step Verification > App passwords,
create one and copy the 16 letters (spaces are ignored). Gmail answers
`535 5.7.8` when the account password is used instead.

Limits: Gmail sends about 500 recipients a day from a personal account (about
2,000 from Workspace); the sender is always the Gmail address, whatever
`MAIL_FROM` says; school spam filters may file the mail as junk; prod must
reach `smtp.gmail.com:587` outbound.

`/admin/email` (admin only) shows the settings (password set yes/no) and sends
a test email (subject *DINO test email*, the time in `TIMEZONE`, the admin's
first name) to any one address, prefilled with the admin's own;
`sendTestEmailAction` allows 5 per admin per 10 minutes (in memory). Tests:
`tests/email/mailer.check.ts` (fake transport, no network, no nodemailer
needed). Adding `nodemailer` means the app images (`Dockerfile-dino`,
`dino-deps`) need a rebuild.

### Forgot password

`/forgot-password` and `/reset-password?token=…` are public
(`src/lib/password-reset.ts`, actions in `server-actions/password-reset.ts`,
migration 153 `password_reset_tokens`). The sign-in page shows *Forgot
password?* only when `passwordResetAvailable()`: SMTP set up and a link origin
(`APP_ORIGIN`, else `NEXT_PUBLIC_APP_URL`; never the Host header). Without it
the forgot page says to ask a teacher. An active account with an email
(lookup by `lower(email)`) gets *Reset your DINO password* with a link that
works for 30 minutes and once. Only the token's sha256 is stored; the raw
token is only in the email. The page **always** gives the same reply
(`FORGOT_PASSWORD_MESSAGE`), for an unknown, inactive or limited address and
when mail fails, and the action does not wait for the SMTP send, so the time
does not tell either. An unknown address still writes a row (`user_id` null,
a token nobody gets) so the IP limit counts it. Limits, read from the table so
every PM2 process agrees: 3 requests per account and 10 per IP
(`x-forwarded-for`) an hour; over a limit, no row and no email. A new request
does not cancel an earlier link. The reset uses the change-password rules
(trimmed, at least 6 characters, not the default) and checks the token again
in the action; in one transaction it sets the hash (bcrypt 10), clears
`must_change_password`, marks the token used, deletes the account's other
tokens and ends all its `auth_sessions`, then sends the user to
`/signin?reset=done` (not signed in). `Referrer-Policy: no-referrer` on
`/reset-password` (`next.config.ts`). Both pages stay open to a signed-in user
with `must_change_password`. Log lines carry the user id (or "no account") and
IP, never the address. Rows older than 7 days are deleted by the next request.
OAuth tokens (MCP, Kerf) are not revoked by a reset. Tests:
`tests/auth/password-reset.check.ts`.

## Scoring Conventions

**Always use `compute_submission_base_score(body, activity_type)`** when computing a submission score in SQL. This is the canonical PostgreSQL function (defined in `schema.sql`) and handles all score fields in the correct priority order:

1. `teacher_override_score` / `override_score` — teacher manually overrides any auto score
2. `multiple-choice-question`: `is_correct` → 1 or 0, fallback to `score` / `auto_score`
3. `short-text-question`: `teacher_ai_score` → `ai_model_score` → `score` → `auto_score`
4. All other scorable types: `score` → `auto_score`
5. Returns `NULL` if the submission exists but has no score yet (not 0)

**Never write ad-hoc COALESCE chains** over individual body fields — they will miss score fields and produce incorrect results. The function accepts both `json` and `jsonb` so it works with the `submissions.body` column directly.

**Scores always come from the latest attempt.** A pupil can have several rows in `submissions` for one activity (`attempt_number` 1, 2, …). The score, marks, feedback comments and every average use only the latest one: highest `attempt_number`, then newest `submitted_at`. Older attempts are kept for audit. Never average, sum or count across a pupil's attempts, and never pick one with `.find` or `limit 1` without that ordering.
- SQL: `distinct on (activity_id, user_id) … order by activity_id, user_id, attempt_number desc, submitted_at desc nulls last, submission_id desc`.
- TypeScript: `latestAttempts()` in `src/lib/scoring/latest-attempt.ts`.
- Don't order by `submitted_at` alone. Some write paths rewrite it on existing rows.

**Progress baseline: missing work counts as 0.** Every progress figure (lesson, unit, class, dashboard, report, LO) uses the same rule, defined once in migration 117:
- **Scope:** every active scorable activity **with success criteria** in a lesson set to the pupil's class whose `start_date` has arrived. An activity with no `activity_success_criteria` rows drops out entirely, marks and `max_marks` alike, including self-marking types (migration 129). Test it with `activity_counts_for_progress(activity_id, type)` in SQL and `countsForProgress(type, criteriaCount)` (`src/lib/scoring/counts-for-progress.ts`) in TypeScript, never `is_scorable_activity_type` alone.
- **Score:** the latest attempt's marks. No submission, or not yet marked, is 0, and the activity still counts in the denominator.
- **Average:** `sum(marks) / sum(max_marks)`, never a mean of per-activity percentages.
- **Pupils only:** staff in a class never count.

For per-activity rows, read the `pupil_activity_scores` view. For per-criterion ratings (LO/SC reports, 0–1, mean of rows), read `pupil_criterion_scores`. Don't re-derive the rules. `is_scorable_activity_type()` in SQL mirrors `SCORABLE_ACTIVITY_TYPES`, so keep the two in step.

On assessment papers, a question with no mark is likewise 0 and stays in the total.

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
- The OAuth server in `src/lib/oauth/` serves two kinds of client: MCP (opaque tokens, teacher only) and first-party Kerf clients (RS256 JWTs, `allowed_roles`, no consent). Every first-party behaviour is a column on `oauth_clients` whose default is MCP's, so keep new behaviour behind those columns. See `docs/KERF-SSO.md`. Roles for a session and for a token both come from `effectiveRoles` in `src/lib/roles.ts`. First-party clients can also be `client_type = 'service'` (confidential, `client_credentials` only, `token_use: "service"` JWTs) and can be managed by per-project API keys at `/api/oauth-clients`, held to a ceiling. Every surface that creates or changes a first-party client must go through `src/lib/oauth/client-store.ts`, which validates with `src/lib/oauth/clients.ts` and audits. See `docs/FIRST-PARTY-CLIENTS.md`.

## Unit Audits

A unit is audited over MCP (`get_unit_audit`, `list_unit_audits`, `record_unit_audit`; see `docs/MCP.md`) and shows its status on `/units/[unitId]`, with a failed audit's actions listed under the description. The status is derived, never stored: `unit_audits.audited_at` against `unit_audits.changed_at` (migration 123). Triggers on `units`, `lessons`, `activities`, `lesson_links`, the LO/SC link tables and `stored_files` stamp `changed_at`, so any new write path is covered without code. A new table that holds unit or lesson content needs a trigger too: `EXECUTE FUNCTION unit_audits_on_change('lesson')` (or `'unit'` / `'activity'`). Code is in `src/lib/unit-audits/store.ts`; tests in `tests/unit-audits/unit-audits.check.ts`.

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

### Intervention lessons — filter `kind = 'standard'` when listing by unit

`lessons.kind` is `'standard'` or `'intervention'` (migration 108). An
intervention is written for ONE pupil (`intervention_assignments`) but still
sits in a unit, so any new query that lists, counts, copies or feeds to AI a
unit's lessons (`where l.unit_id = …`, or all lessons) must add
`and l.kind = 'standard'` — otherwise one pupil's work appears for the whole
class. Queries that reach lessons only through `lesson_assignments` /
`planner_assignments` are already safe: the database refuses to plan an
intervention for a class or make it public. Pupil access to an intervention
goes through `interventionAllowsPupil` in `src/lib/interventions/store.ts`.

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

### Marking prompts

`get_activity_marking_prompt` / `set_activity_marking_prompt` (`src/lib/mcp/marking-prompts.ts`) read and write `body_data.markingGuidance` of short-text-question, upload-code, upload-spreadsheet, upload-worksheet, mark-worksheet and upload-file (with its `ai_marking` switch). Writes go through `updateActivity`, and the worksheet types are checked against their body schemas there too. Question-marked types are refused and pointed to `set_assessment_activity_questions`. The tool's `remark` (default true) re-marks each pupil's latest submission already sent for marking when the prompt text changed, through `enqueueMarkingTasks` (`src/lib/mcp/marking-prompt-remark.ts`; not fully teacher-marked work, not an upload-file with Mark with AI off); `false` saves only. Tests: `tests/mcp/marking-prompts.check.ts`, `tests/mcp/marking-prompt-remark.check.ts`.

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
