# Marks-Based Scoring — Phase 2 (Remaining Read Paths) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the scope gap found in the Phase 1 final review: convert every remaining live read path that still computes scores from deprecated 0-1 fraction fields (`score`, `auto_score`, `ai_model_score`, `teacher_override_score`, fraction-based `is_correct`) to use whole-number marks, so no page silently drifts as new submissions are marked (Phase 1 write paths only update `marks`/`ai_marks`/`marks_override` going forward).

**Architecture:** Same single-pass cutover philosophy as Phase 1. Reuse `compute_submission_marks` (SQL) and `computeSubmissionMarks` (TS, in `src/lib/server-actions/submissions.ts` — currently unexported, exported in Task 11) wherever a priority-chain computation is needed. Where a file does raw `SUM(score)`/`AVG(score)` SQL aggregation, rewrite to `SUM(marks)/SUM(max_marks)*100` using the same pattern established in Phase 1's `lesson_assignment_score_summaries` rewrite.

**Tech Stack:** Next.js 15, PostgreSQL via `pg`, Zod, server actions.

## Global Constraints

- Same constraints as Phase 1 (`docs/superpowers/plans/2026-06-30-marks-based-scoring.md` Global Constraints section applies verbatim) — marks always whole numbers, MCQ all-or-nothing, unmarked stays NULL, old fraction fields remain readable for rollback but must not be relied on as primary source after this lands.
- `pupil_lessons_summary_bootstrap` and `pupil_lessons_detail_bootstrap` are confirmed (via direct grep of their authoritative definitions in `src/migrations/applied/047-update-pupil-bootstrap.sql`) to contain ZERO scoring logic — pure roster/curriculum-structure queries. They do not need conversion. This corrects the original Phase 1 spec, which assumed they needed marks-based treatment.
- `src/lib/server-actions/dashboard.ts`'s two `compute_submission_base_score` references are NULL-checks only (no value math) and the file currently has no confirmed `.tsx` importer — Task 17 verifies whether it's dead code before deciding whether conversion is needed at all.

---

## Task 11: Export `computeSubmissionMarks` (prerequisite)

**Files:**
- Modify: `src/lib/server-actions/submissions.ts` (the `computeSubmissionMarks` function, currently a bare unexported `function` declaration around line 81)

**Interfaces:**
- Produces: `export function computeSubmissionMarks(body: unknown, activityType: string, maxMarks: number): number | null` — importable by every later task in this phase.

- [ ] **Step 1: Add `export` to the function declaration**

Locate `function computeSubmissionMarks(...)` in `src/lib/server-actions/submissions.ts` and change to `export function computeSubmissionMarks(...)`. Do not change its internals — Task 1/Task 8 of Phase 1 already validated this logic matches the SQL `compute_submission_marks` function exactly.

- [ ] **Step 2: Run `pnpm exec tsc --noEmit`**

Confirm no new errors (only the 2 known pre-existing unrelated errors in `tests/prototypes/fast-ui.spec.ts` should remain).

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/submissions.ts
git commit -m "refactor: export computeSubmissionMarks for reuse across remaining score read paths"
```

---

## Task 12: Convert `src/lib/scoring/activity-scores.ts`

**Files:**
- Modify: `src/lib/scoring/activity-scores.ts` (`extractScoreFromSubmission` and related logic at lines 105-111, 201-207, 269-275, 345-365, 436, 500-520, 576, 616-617, 640-642)
- Consumed by: `src/components/assignment-results/assignment-results-dashboard.tsx`, `src/lib/server-actions/assignment-results.ts` — do not modify these consumers in this task unless `extractScoreFromSubmission`'s return type/shape must change (if so, update call sites to match, keeping the rest of those files untouched).

**Interfaces:**
- Consumes: `computeSubmissionMarks` (Task 11), `activity.max_marks`.
- Produces: `extractScoreFromSubmission` (or its replacement) returns marks-based values (`marksAwarded`, `maxMarks`) instead of, or alongside, the current fraction-based `effectiveScore`/`overrideScore`/`autoScore` fields — consumers (assignment-results dashboard) must keep compiling and displaying correctly.

- [ ] **Step 1: Read the current implementation in full**

Run: `sed -n '1,650p' src/lib/scoring/activity-scores.ts` to see the whole file (it's the largest conversion target). Identify every place it reads `teacher_override_score`, `is_correct`, `score`, `auto_score`, `ai_model_score`, `success_criteria_scores`.

- [ ] **Step 2: Identify every consumer of `extractScoreFromSubmission`'s return value**

Run: `grep -rn "extractScoreFromSubmission\|effectiveScore\|overrideScore\|autoScore" src/components/assignment-results/assignment-results-dashboard.tsx src/lib/server-actions/assignment-results.ts`

- [ ] **Step 3: Rewrite the priority-chain logic to use `computeSubmissionMarks`**

Replace the ad-hoc fraction priority chain with a call to `computeSubmissionMarks(body, activityType, maxMarks)`, returning whole-number marks. Where the function currently returns a 0-1 `effectiveScore`, add (or replace with) `marksAwarded`/`maxMarks` fields. Where consumers display a percentage, compute it as `(marksAwarded / maxMarks) * 100` at the display layer — do not silently keep producing a fraction internally and relabeling it.

- [ ] **Step 4: Update every consumer identified in Step 2**

For each call site in the dashboard/assignment-results files, update to read the new marks-based fields and render consistently with how Phase 1's Task 8 fix rendered marks in the same dashboard (whole-number "X / max_marks" or computed percentage, matching surrounding UI).

- [ ] **Step 5: Run `pnpm exec tsc --noEmit`**

Report all errors; fix any introduced by the shape change.

- [ ] **Step 6: Manual verification**

Since this feeds the assignment-results dashboard (already covered by Phase 1 Task 8's manual trace), trace through one MCQ and one short-text-question example by hand: given a known `marks`/`ai_marks`/`marks_override` value and `max_marks`, confirm `extractScoreFromSubmission`'s new output matches `compute_submission_marks`'s SQL output for the same submission (spot-check via `psql` against a real submission_id in this worktree's DB).

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoring/activity-scores.ts src/components/assignment-results/assignment-results-dashboard.tsx src/lib/server-actions/assignment-results.ts
git commit -m "feat: convert activity-scores.ts and assignment-results dashboard to marks-based scoring"
```

---

## Task 13: Convert `src/lib/server-actions/pupil-units.ts`

**Files:**
- Modify: `src/lib/server-actions/pupil-units.ts` (SQL at lines 371, 411, 420; TS plumbing at 564-699)

**Interfaces:**
- Consumes: `compute_submission_marks` (SQL, Task 1 of Phase 1).
- Produces: `readPupilUnitsBootstrapAction`'s score fields are marks-weighted percentages, consistent with the rest of the app.

- [ ] **Step 1: Read the current SQL and TS logic**

Run: `sed -n '360,430p;560,700p' src/lib/server-actions/pupil-units.ts`

- [ ] **Step 2: Rewrite the SQL aggregation**

Replace `compute_submission_base_score(...)` calls and raw `SUM(score)` at lines 371/420 with `compute_submission_marks(body::jsonb, type, max_marks)` and a `SUM(marks)/SUM(max_marks)*100` aggregation pattern, joining `activities` for `max_marks` wherever the query doesn't already have it in scope.

- [ ] **Step 3: Update the TS plumbing (lines 564-699)**

Adjust any code treating the resulting value as a 0-1 scale to instead treat it as the marks-derived percentage now returned by the rewritten SQL.

- [ ] **Step 4: Run `pnpm exec tsc --noEmit`**, fix any new errors.

- [ ] **Step 5: Manual verification**

This feeds the flashcards monitor/pupil pages, `api/unit-report-docx`, `api/unit-report`. Run the rewritten query against a real unit/pupil in this worktree's DB via `psql`, confirm the percentage is plausible and matches a manual `compute_submission_marks`-based calculation for the same data.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions/pupil-units.ts
git commit -m "feat: convert pupil-units scoring aggregation to marks-based"
```

---

## Task 14: Convert `src/lib/server-actions/weekly-planner.ts`

**Files:**
- Modify: `src/lib/server-actions/weekly-planner.ts` (lines 228-264: `compute_submission_base_score` at 231, `coalesce(sum(ls.score),0)` fraction aggregation)

**Interfaces:**
- Consumes: `compute_submission_marks` (SQL).
- Produces: `lesson_score` in this file's query output becomes a marks-weighted percentage.

- [ ] **Step 1: Read lines 200-270**

Run: `sed -n '200,270p' src/lib/server-actions/weekly-planner.ts`

- [ ] **Step 2: Rewrite the scoring CTE/subquery**

Replace `compute_submission_base_score` + `sum(ls.score)` with `compute_submission_marks(...)` + `SUM(marks)/SUM(max_marks)*100`, joining `activities` for `max_marks` as needed.

- [ ] **Step 3: Run `pnpm exec tsc --noEmit`**, fix any new errors.

- [ ] **Step 4: Manual verification**

Feeds `TeacherPlannerClient.tsx` and `PupilPlannerClient.tsx`. Run the rewritten query via `psql` against real data in this worktree's DB, confirm `lesson_score` values are plausible percentages.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/weekly-planner.ts
git commit -m "feat: convert weekly-planner lesson_score aggregation to marks-based"
```

---

## Task 15: Convert `src/lib/server-actions/planner-assignments.ts`

**Files:**
- Modify: `src/lib/server-actions/planner-assignments.ts` (line 219: `ROUND(100.0 * AVG(compute_submission_base_score(...)))::int`)

**Interfaces:**
- Consumes: `compute_submission_marks` (SQL).
- Produces: the percentage feeding the Zod-validated `int` field (line 191) is now marks-weighted.

- [ ] **Step 1: Read the query around line 191-225**

Run: `sed -n '185,225p' src/lib/server-actions/planner-assignments.ts`

- [ ] **Step 2: Rewrite the aggregation**

Replace `AVG(compute_submission_base_score(...))` with the marks-weighted equivalent: `ROUND(100.0 * SUM(compute_submission_marks(body::jsonb, type, max_marks)) / NULLIF(SUM(max_marks), 0))::int`, joining `activities` for `max_marks`. Guard div-by-zero with `NULLIF`.

- [ ] **Step 3: Run `pnpm exec tsc --noEmit`**, fix any new errors.

- [ ] **Step 4: Manual verification**

Feeds the Scheme of Work planner (`src/app/sow/[groupId]/`). Run via `psql` against real data, confirm plausible percentages, no NULL/divide errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/planner-assignments.ts
git commit -m "feat: convert planner-assignments percentage aggregation to marks-based"
```

---

## Task 16: Convert `src/lib/server-actions/tasks.ts`

**Files:**
- Modify: `src/lib/server-actions/tasks.ts` (line 123 `compute_submission_base_score` already correct call but feeds fraction math at 133/145/150; hardcoded `(ls.score / ls.max_score) < 0.8` threshold)

**Interfaces:**
- Consumes: `compute_submission_marks` (SQL).
- Produces: the "Tasks" page's completion/score logic uses marks-weighted values; the `0.8` threshold is reinterpreted against the marks-based ratio (same threshold value, new data source).

- [ ] **Step 1: Read lines 110-155**

Run: `sed -n '110,155p' src/lib/server-actions/tasks.ts`

- [ ] **Step 2: Rewrite the aggregation and threshold**

Replace the fraction-scale `sum(ls.score)`/`ls.max_score` logic with `compute_submission_marks` + `SUM(marks)`/`SUM(max_marks)`, and rewrite `(ls.score / ls.max_score) < 0.8` as `(SUM(marks)::numeric / NULLIF(SUM(max_marks), 0)) < 0.8` (same 0.8 threshold, now operating on the marks ratio rather than the old fraction — these are equivalent ratios, so the threshold value itself does not need to change).

- [ ] **Step 3: Run `pnpm exec tsc --noEmit`**, fix any new errors.

- [ ] **Step 4: Manual verification**

Feeds the pupil "Tasks" page (`src/app/tasks/page.tsx`). Run via `psql` against real data, confirm task completion/threshold logic produces the same pass/fail classification it would have for a known fraction-equivalent case.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/tasks.ts
git commit -m "feat: convert tasks.ts scoring aggregation and threshold to marks-based"
```

---

## Task 17: Convert `unit-progress-reports/actions.ts` fraction-scale aggregation, and resolve `dashboard.ts`

**Files:**
- Modify: `src/app/unit-progress-reports/actions.ts` (line 234: `AVG(... score)` fraction-scale aggregation — the 5 `compute_submission_base_score` calls at lines 28/78/143/215/299 are NULL-checks or feed this same aggregation and should be reviewed alongside it)
- Investigate: `src/lib/server-actions/dashboard.ts` (lines 69, 470 — NULL-check only usage; confirm whether this file has any live importer)

**Interfaces:**
- Consumes: `compute_submission_marks` (SQL).

- [ ] **Step 1: Read `unit-progress-reports/actions.ts` around line 234 and its surrounding query**

Run: `sed -n '1,320p' src/app/unit-progress-reports/actions.ts | grep -n "compute_submission_base_score\|AVG\|score" `

- [ ] **Step 2: Rewrite the `AVG(... score)` aggregation to marks-weighted**

Same pattern as prior tasks: `SUM(marks)/SUM(max_marks)*100` via `compute_submission_marks`, joined to `activities` for `max_marks`.

- [ ] **Step 3: Determine whether `dashboard.ts` is dead code**

Run: `grep -rln "from .*server-actions/dashboard\"" src/` and `grep -rln "from .*server-actions/dashboard'" src/` (check both quote styles) plus `grep -rn "readDashboard\|dashboardBootstrap" src/app src/components` (adjust to the actual exported function names in `dashboard.ts` — read the file first to get them). If genuinely no importer exists anywhere in `src/app` or `src/components`, leave it unconverted and note in your report that it's dead code out of scope (do not delete it in this task — deletion of confirmed-dead code is a separate, explicit decision, not implied by this plan). If you DO find a live importer, convert its `compute_submission_base_score` usage the same way as the other tasks in this phase, even though it's currently NULL-check-only — extend it to real marks-based value computation if the live importer actually needs a value (not just a NULL-check), matching the pattern used elsewhere.

- [ ] **Step 4: Run `pnpm exec tsc --noEmit`**, fix any new errors.

- [ ] **Step 5: Manual verification**

Feeds the Unit Progress Reports pages. Run the rewritten query via `psql` against real data, confirm plausible percentages.

- [ ] **Step 6: Commit**

```bash
git add src/app/unit-progress-reports/actions.ts src/lib/server-actions/dashboard.ts
git commit -m "feat: convert unit-progress-reports aggregation to marks-based; document dashboard.ts dead-code status"
```

---

## Task 18: Convert `src/app/reports/[pupilId]/report-data.ts`

**Files:**
- Modify: `src/app/reports/[pupilId]/report-data.ts` (lines 580-595, 605-621, 641-660, 669-687, 710-756, 867-875, 1045, 1162, 1182, 1192 — largest concentration of ad-hoc fraction logic: reads `is_correct`, `teacher_override_score`, `ai_model_score`, `score`, builds `activitiesScore` reduces and LO/SC averages entirely in TS)

**Interfaces:**
- Consumes: `computeSubmissionMarks` (Task 11, TS).
- Produces: the pupil report page (`report-view.tsx`) shows the same marks-weighted percentage as the dashboard/activity-view for the same underlying submissions — closing the explicitly-flagged inconsistency from the Phase 1 final review.

- [ ] **Step 1: Read the full file, focusing on the listed line ranges**

Run: `sed -n '570,760p;860,880p;1040,1050p;1155,1200p' src/app/reports/[pupilId]/report-data.ts`

- [ ] **Step 2: Rewrite each fraction-based computation to use `computeSubmissionMarks`**

For each of the listed reduces/averages, replace the ad-hoc fraction priority chain with `computeSubmissionMarks(body, activityType, maxMarks)`, then compute displayed percentages as `(marksAwarded / maxMarks) * 100` at the point of use (LO/SC averages, `activitiesScore`, etc.). This file does NOT have per-success-criterion marks (Phase 1 design explicitly scoped marks to per-activity, not per-criterion) — where the current code averages per-success-criterion fraction scores, replace with the same approved simplification used in Phase 1 Task 2 (drop per-criterion sub-averaging, use the per-activity marks ratio directly), and note this in your report for consistency with the rest of the app.

- [ ] **Step 3: Run `pnpm exec tsc --noEmit`**, fix any new errors.

- [ ] **Step 4: Cross-check against the dashboard for the same data**

Pick a real pupil/lesson combination with submissions in this worktree's DB. Compute the percentage both via this file's new logic (trace by hand or via a temporary script) and via `lesson_assignment_score_summaries`/the dashboard's now-converted logic (Task 12). Confirm they agree (or document any expected, justified difference — e.g. if report-data.ts aggregates over a different activity set than the dashboard).

- [ ] **Step 5: Commit**

```bash
git add "src/app/reports/[pupilId]/report-data.ts"
git commit -m "feat: convert pupil report page to marks-based scoring, closing dashboard/report inconsistency"
```

---

## Task 19: Phase 2 end-to-end verification

**Files:**
- None modified — verification only.

- [ ] **Step 1: Run `pnpm exec tsc --noEmit` and `pnpm lint`**

Report results (lint is known to fail with a pre-existing unrelated ESLint config error — confirm this is still the only failure).

- [ ] **Step 2: Re-run the broad spot-check from Phase 1 Task 10**

Run: `grep -rn "compute_submission_base_score\|ai_model_score\|teacher_override_score" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules"`. For every remaining hit, confirm it is either (a) inside `src/migrations/` (the old function definition itself, kept for rollback), or (b) a documented, justified read of the old field for backward-compat/rollback purposes — not a live, unconverted scoring computation. Any remaining unconverted live computation found here is a real gap — fix it as part of this task or escalate.

- [ ] **Step 3: Cross-page consistency check**

For one real pupil with submissions across multiple lessons in this worktree's DB, manually compare the percentage shown by: the assignment-results dashboard's logic (Task 12), `lesson_assignment_score_summaries` (Phase 1 Task 2), and `report-data.ts` (Task 18). Document the values and confirm they agree (within any documented, justified differences).

- [ ] **Step 4: Commit any final fixes found**

```bash
git add -A
git commit -m "fix: address issues found during phase 2 end-to-end verification"
```
