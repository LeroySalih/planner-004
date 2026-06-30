# Marks-Based Scoring

## Problem

Activity scoring is currently a 0–1 fraction (effectively a percentage) stored across several keys inside `submissions.body` JSON (`score`, `auto_score`, `ai_model_score`, `teacher_ai_score`, `teacher_override_score`, `is_correct`), and clamped via `clamp_score()` / `compute_submission_base_score`. There is no concept of "marks available" per activity — everything is implicitly out of 1.

We want activities to instead be marked out of a configurable whole number of marks (e.g. 7/10), with reporting/level boundaries continuing to show an aggregated percentage. This is a full cutover, not a long-lived parallel system — old fraction fields stay in the schema for rollback safety but are not used by the app after this ships.

## Decisions

- **Marks live on the activity**: `activities.max_marks INTEGER NOT NULL DEFAULT 1`, one value per activity (not per-assignment or per-pupil).
- **Applies to all scorable types** (`SCORABLE_ACTIVITY_TYPES` in `src/dino.config.ts`). Non-scorable display types are unaffected.
- **Type defaults**: `multiple-choice-question` → 1 mark, `short-text-question` → 3 marks, everything else → 1 mark (the column default).
- **Marks are always whole numbers.** No fractional marks anywhere in the new system.
- **MCQ stays all-or-nothing** for this change: correct = full `max_marks`, incorrect = 0. Partial credit / multi-correct-option MCQs are explicitly out of scope (future work).
- **Marks awarded is the new source of truth**, stored as new keys inside `submissions.body` JSON (mirroring how scoring already works there — there is no separate `attempts` table; each attempt is its own row in `submissions` with an `attempt_number`).
- **AI marking outputs whole marks directly** against the activity's configured max (e.g. "this is worth 4 marks, AI gives 3"), not a 0–1 confidence score that's later multiplied.
- **Reporting aggregates as `SUM(marks_awarded) / SUM(max_marks)`** across an attempt's activities, converted to a percentage for level-boundary lookups (`getLevelForYearScore` keeps consuming 0–100 percentages, no change to boundary tables).
- **`lesson_assignment_score_summaries`'s type-filter gap is closed** as part of this work — it currently only covers `multiple-choice-question`, `short-text-question`, `upload-file`, narrower than the full `SCORABLE_ACTIVITY_TYPES` list; this change widens it to match.
- **Pupils see `marks_awarded / max_marks`** (e.g. "7/10") on feedback/attempt views. Lesson/report-level views keep showing the aggregated percentage.
- **Backfill, not parallel-write**: existing submissions are migrated once via `marks = CEIL(compute_submission_base_score(body, type) * max_marks_for_type)`, applied to every row in `submissions` (all past attempts, not just the latest). Unmarked (`NULL` score) submissions stay unmarked (`NULL` marks) — no fabricated zeros.
- **Old fraction fields and `clamp_score()`/`compute_submission_base_score` are kept in the schema for rollback safety but are dead code after this ships** — no application path reads or writes them post-migration. Flagged for a future cleanup pass, not part of this change.

## Data Model

### `activities` table
- New column: `max_marks INTEGER NOT NULL DEFAULT 1`, `CHECK (max_marks > 0)`

### `submissions.body` JSON
New keys (parallel structure to the existing fraction keys, replacing them in all code paths):

| Old key (deprecated) | New key |
|---|---|
| `score` | `marks` |
| `auto_score` | `auto_marks` |
| `ai_model_score` | `ai_marks` |
| `teacher_ai_score` | `teacher_ai_marks` |
| `teacher_override_score` | `marks_override` |
| `is_correct` (MCQ) | unchanged — still the underlying correctness signal, but now maps to `max_marks`/`0` instead of `1`/`0` |

All new keys are whole-number integers (or `NULL` for unmarked), validated `0 ≤ value ≤ activity.max_marks` at the server-action layer (Zod `.int().min(0)` plus an explicit runtime check against the activity's `max_marks`, since Zod alone can't see the cross-table max).

## Computation

New SQL function `compute_submission_marks(body jsonb, activity_type text, max_marks integer) RETURNS integer`, mirroring `compute_submission_base_score`'s priority chain:

1. `marks_override` — manual teacher override
2. `multiple-choice-question`: `is_correct` → `max_marks` or `0`
3. `short-text-question`: `teacher_ai_marks` → `ai_marks` → `marks` → `auto_marks`
4. All other scorable types: `marks` → `auto_marks`
5. Returns `NULL` if the submission exists but is unmarked (not 0)

Result is clamped `[0, max_marks]`. This function becomes the canonical scoring read path, replacing `compute_submission_base_score` everywhere in application/reporting code.

## Write Paths

- All server actions currently writing fraction-based score keys into `submissions.body` are updated to write the equivalent whole-mark keys.
- AI marking (short-text-question, `src/lib/server-actions/short-text.ts`): the marking prompt is updated to state the activity's `max_marks` and request a whole-number mark 0–`max_marks` directly, replacing the current 0–1 fraction + threshold-derived `is_correct` approach.
- MCQ marking: `is_correct` boolean is still computed the same way; only its mapping to marks changes (`true → max_marks`, `false → 0`).

## Reporting & Levels

- `lesson_assignment_score_summaries`: rewritten to join `submissions` → `activities` and aggregate `SUM(compute_submission_marks(...)) / SUM(max_marks)` per lesson/pupil, with the type filter widened to the full `SCORABLE_ACTIVITY_TYPES` list.
- `pupil_lessons_summary_bootstrap`, `pupil_lessons_detail_bootstrap`, and the assignments bootstrap RPC (`assignments_bootstrap`) get the same marks-based aggregation treatment, replacing their current fraction-based logic.
- `getLevelForYearScore` (`src/lib/levels/index.ts`) is unchanged in its boundary logic — it continues to take a 0–100 percentage. The percentage it receives is now always computed as `(SUM(marks_awarded) / SUM(max_marks)) * 100` upstream, rather than passed through as a raw fraction.

## UI

- **Activity editor**: the existing percentage/weight field (if any) is replaced with a single "Marks available" whole-number input. Default 1 (3 for short-text-question). Validated `> 0`.
- **Teacher marking screens** (attempt detail modal, feedback editor): score entry becomes a "Marks awarded" whole-number field, with the activity's max shown alongside (e.g. "out of 4"). Validated `0 ≤ marks_awarded ≤ max_marks`.
- **Pupil-facing views** (feedback, attempt detail): display `marks_awarded / max_marks` (e.g. "7/10") instead of a percentage.
- **Lesson/report-level views**: unchanged — continue showing the aggregated percentage.

## Migration

New migration file in `src/migrations/`, applied as a single coordinated change:

1. `ALTER TABLE activities ADD COLUMN max_marks INTEGER NOT NULL DEFAULT 1`
2. `UPDATE activities SET max_marks = 3 WHERE type = 'short-text-question'`
3. Add `compute_submission_marks` SQL function
4. Backfill: for every row in `submissions`, compute `CEIL(compute_submission_base_score(body, type) * max_marks_for_activity) `and write it into the row's `body` JSON under the new key set (`marks`, carrying forward `marks_override` where a `teacher_override_score` existed). Applies to all attempts (every row), not just the latest per pupil/activity.
5. Update `lesson_assignment_score_summaries` and related RPCs to the new aggregation (see Reporting section).

Old columns/keys and `clamp_score()`/`compute_submission_base_score` remain present in the schema for rollback safety but are not referenced by any application code after this migration ships.

## Error Handling

- `marks_awarded` outside `[0, max_marks]` is rejected at the server-action layer, returning the standard `{ data: null, error }` shape — never silently clamped.
- Unmarked submissions remain `NULL` throughout (computation, backfill, and display) — never coerced to 0.

## Testing

- New Playwright E2E coverage: setting "marks available" on an activity, marking a submission with whole-number marks (including a validation-rejection case for out-of-range values), pupil view rendering "x/y", and a lesson report showing the correctly aggregated percentage.
- No unit test infrastructure exists in this repo (per CLAUDE.md) — backfill correctness is verified via manual SQL spot-checks comparing `compute_submission_base_score` (old) against `compute_submission_marks` (new) results on a sample of existing submissions before deploying.

## Out of Scope

- Partial-credit / multi-correct-option MCQ scoring (future work).
- Per-assignment or per-pupil marks-available overrides (marks-available is fixed per activity).
- Removing the deprecated fraction-based fields/functions from the schema (kept for rollback safety; cleanup is a separate future task).
