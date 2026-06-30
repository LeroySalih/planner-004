# Marks-Based Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 0–1 fraction-based activity scoring with whole-number marks-awarded / marks-available, end to end (schema, AI marking, teacher marking UI, pupil display, reporting/levels).

**Architecture:** Single-pass migration (no parallel-write transition). Add `activities.max_marks`, add new whole-number JSON keys to `submissions.body` (`marks`, `auto_marks`, `ai_marks`, `teacher_ai_marks`, `marks_override`), add a `compute_submission_marks` SQL function mirroring the existing `compute_submission_base_score`, backfill every existing submission row, then cut every read/write path over to the new fields in one coordinated set of changes. Old fraction fields and functions stay in the schema for rollback safety but are no longer used by application code after this lands.

**Tech Stack:** Next.js 15 (App Router), PostgreSQL via `pg`, Zod, server actions.

## Global Constraints

- Marks are always whole numbers — `0 ≤ marks_awarded ≤ max_marks`, enforced with `.int()` Zod validation plus an explicit runtime check against the activity's `max_marks` (cross-field, so Zod alone can't express it).
- `max_marks` defaults: `multiple-choice-question` → 1, `short-text-question` → 3, all other scorable types → 1 (column default).
- Scorable types are defined by `SCORABLE_ACTIVITY_TYPES` in `src/dino.config.ts:1-15`.
- Unmarked submissions stay `NULL` marks — never coerced to 0.
- MCQ stays all-or-nothing: correct → `max_marks`, incorrect → 0. No partial credit (future work, out of scope).
- Old fraction fields (`score`, `auto_score`, `ai_model_score`, `teacher_ai_score`, `teacher_override_score`, `is_correct` mapping to 1/0) and `clamp_score()`/`compute_submission_base_score` remain in the DB schema but must not be read or written by any application code after this plan completes.
- Per CLAUDE.md: 2-space indentation, server actions validate with Zod and return `{ data, error }`, follow the insert-only attempts pattern already established for `submissions` (each attempt is its own row with `attempt_number`).
- Spec: `docs/superpowers/specs/2026-06-30-marks-based-scoring-design.md`

---

## Task 1: Migration — schema, functions, and backfill

**Files:**
- Create: `src/migrations/077-marks-based-scoring.sql`

**Interfaces:**
- Produces: `activities.max_marks` column (integer, not null, default 1), SQL function `compute_submission_marks(body jsonb, activity_type text, max_marks integer) RETURNS integer`, SQL function `clamp_marks(value integer, max_marks integer) RETURNS integer`. Both consumed by Task 2 (reporting SQL) and by every server action in Tasks 4–6 for read-back validation.

- [ ] **Step 1: Write the migration file**

```sql
-- src/migrations/077-marks-based-scoring.sql
-- Adds whole-number marks-based scoring alongside the existing fraction-based
-- scoring (which remains for rollback safety but is no longer used by the app).

-- 1. Add max_marks to activities, defaulting to 1, with short-text-question at 3.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_marks INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activities ADD CONSTRAINT activities_max_marks_positive CHECK (max_marks > 0);

UPDATE activities SET max_marks = 3 WHERE type = 'short-text-question' AND max_marks = 1;

-- 2. clamp_marks: clamps an integer to [0, max_marks], NULL passthrough.
CREATE OR REPLACE FUNCTION clamp_marks(value INTEGER, max_marks INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;
  IF value < 0 THEN
    RETURN 0;
  END IF;
  IF value > max_marks THEN
    RETURN max_marks;
  END IF;
  RETURN value;
END;
$$;

-- 3. compute_submission_marks: marks-based counterpart to compute_submission_base_score.
-- Priority: marks_override -> MCQ is_correct (scaled to max_marks) -> STQ teacher_ai_marks/ai_marks/marks/auto_marks
-- -> generic marks/auto_marks. Returns NULL if nothing found (unmarked).
CREATE OR REPLACE FUNCTION compute_submission_marks(body JSONB, activity_type TEXT, max_marks INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  override_val INTEGER;
  is_correct_val BOOLEAN;
  result INTEGER;
BEGIN
  IF body IS NULL THEN
    RETURN NULL;
  END IF;

  override_val := (body->>'marks_override')::INTEGER;
  IF override_val IS NOT NULL THEN
    RETURN clamp_marks(override_val, max_marks);
  END IF;

  IF activity_type IN ('multiple-choice-question', 'matcher') THEN
    is_correct_val := (body->>'is_correct')::BOOLEAN;
    IF is_correct_val IS NOT NULL THEN
      RETURN CASE WHEN is_correct_val THEN max_marks ELSE 0 END;
    END IF;
    result := COALESCE((body->>'marks')::INTEGER, (body->>'auto_marks')::INTEGER);
    RETURN clamp_marks(result, max_marks);
  END IF;

  IF activity_type = 'short-text-question' THEN
    result := COALESCE(
      (body->>'teacher_ai_marks')::INTEGER,
      (body->>'ai_marks')::INTEGER,
      (body->>'marks')::INTEGER,
      (body->>'auto_marks')::INTEGER
    );
    RETURN clamp_marks(result, max_marks);
  END IF;

  result := COALESCE((body->>'marks')::INTEGER, (body->>'auto_marks')::INTEGER);
  RETURN clamp_marks(result, max_marks);
END;
$$;

-- 4. Backfill: write marks/marks_override into every existing submissions.body row,
-- derived from the existing fraction-based score, using each activity's max_marks.
-- ceil(fraction * max_marks); unmarked (NULL base score) stays NULL.
WITH activity_max AS (
  SELECT activity_id, type, max_marks FROM activities
)
UPDATE submissions s
SET body = (
  CASE
    WHEN compute_submission_base_score(s.body, am.type) IS NULL THEN s.body
    ELSE jsonb_set(
      s.body::jsonb,
      '{marks}',
      to_jsonb(CEIL(compute_submission_base_score(s.body, am.type) * am.max_marks)::INTEGER),
      true
    )
  END
)::json
FROM activity_max am
WHERE s.activity_id = am.activity_id;

-- Carry forward any existing teacher_override_score into marks_override.
WITH activity_max AS (
  SELECT activity_id, max_marks FROM activities
)
UPDATE submissions s
SET body = jsonb_set(
  s.body::jsonb,
  '{marks_override}',
  to_jsonb(CEIL(((s.body::jsonb->>'teacher_override_score')::numeric) * am.max_marks)::INTEGER),
  true
)::json
FROM activity_max am
WHERE s.activity_id = am.activity_id
  AND s.body::jsonb->>'teacher_override_score' IS NOT NULL;
```

- [ ] **Step 2: Apply the migration to the local dev database**

Run: `psql "$DATABASE_URL" -f src/migrations/077-marks-based-scoring.sql`
Expected: no errors; `ALTER TABLE`, `CREATE FUNCTION` x2, `UPDATE` statements report row counts.

- [ ] **Step 3: Verify with spot-check SQL**

Run:
```sql
SELECT a.type, a.max_marks, count(*) FROM activities a GROUP BY 1, 2 ORDER BY 1;

SELECT s.submission_id, a.type, a.max_marks,
       compute_submission_base_score(s.body, a.type) AS old_fraction,
       compute_submission_marks(s.body, a.type, a.max_marks) AS new_marks
FROM submissions s JOIN activities a ON a.activity_id = s.activity_id
WHERE compute_submission_base_score(s.body, a.type) IS NOT NULL
LIMIT 20;
```
Expected: `max_marks` is 3 for short-text-question rows, 1 for everything else; `new_marks` is a whole number consistent with `old_fraction * max_marks` rounded up, and matches for every sampled row.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/077-marks-based-scoring.sql
git commit -m "feat: add marks-based scoring schema, functions, and backfill migration"
```

---

## Task 2: Reporting SQL — `lesson_assignment_score_summaries`

**Files:**
- Modify: `src/migrations/077-marks-based-scoring.sql` (append to the same migration file from Task 1, since it's one coordinated cutover)
- Reference: `src/migrations/schema.sql:245-352` for current definition to replace
- Reference: `src/dino.config.ts:1-15` for `SCORABLE_ACTIVITY_TYPES`

**Interfaces:**
- Consumes: `compute_submission_marks` from Task 1.
- Produces: `lesson_assignment_score_summaries(...)` returning a percentage column computed as `SUM(marks_awarded) / SUM(max_marks) * 100`, covering the full `SCORABLE_ACTIVITY_TYPES` list (13 types) instead of the current 3.

- [ ] **Step 1: Read the current function definition**

Run: `sed -n '245,352p' src/migrations/schema.sql`
Confirm the existing signature, return columns, and grouping (per lesson/pupil group, using latest submission per activity, averaging `compute_submission_base_score` then `clamp_score(total/count)`).

- [ ] **Step 2: Append the replacement function to `077-marks-based-scoring.sql`**

```sql
-- 5. Rewrite lesson_assignment_score_summaries to aggregate marks across the
-- full SCORABLE_ACTIVITY_TYPES list instead of the prior 3-type subset.
CREATE OR REPLACE FUNCTION lesson_assignment_score_summaries(p_lesson_id TEXT)
RETURNS TABLE (
  group_id TEXT,
  user_id TEXT,
  has_submission BOOLEAN,
  percentage NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH scorable_activities AS (
    SELECT activity_id, lesson_id, type, max_marks
    FROM activities
    WHERE lesson_id = p_lesson_id
      AND active IS NOT FALSE
      AND type IN (
        'multiple-choice-question', 'short-text-question', 'text-question',
        'long-text-question', 'upload-file', 'upload-url', 'upload-spreadsheet',
        'upload-worksheet', 'feedback', 'sketch-render', 'do-flashcards',
        'matcher', 'group-items'
      )
  ),
  latest_submissions AS (
    SELECT DISTINCT ON (s.activity_id, s.user_id)
      s.activity_id, s.user_id, s.body
    FROM submissions s
    JOIN scorable_activities sa ON sa.activity_id = s.activity_id
    ORDER BY s.activity_id, s.user_id, s.attempt_number DESC
  ),
  marks_per_submission AS (
    SELECT
      ls.user_id,
      sa.max_marks,
      compute_submission_marks(ls.body, sa.type, sa.max_marks) AS marks_awarded
    FROM latest_submissions ls
    JOIN scorable_activities sa ON sa.activity_id = ls.activity_id
  )
  SELECT
    p_lesson_id AS group_id,
    mps.user_id,
    bool_or(mps.marks_awarded IS NOT NULL) AS has_submission,
    CASE
      WHEN SUM(mps.max_marks) FILTER (WHERE mps.marks_awarded IS NOT NULL) > 0
      THEN ROUND(
        100.0 * SUM(mps.marks_awarded) FILTER (WHERE mps.marks_awarded IS NOT NULL)
        / SUM(mps.max_marks) FILTER (WHERE mps.marks_awarded IS NOT NULL),
        2
      )
      ELSE NULL
    END AS percentage
  FROM marks_per_submission mps
  GROUP BY mps.user_id;
$$;
```

- [ ] **Step 3: Apply and verify**

Run: `psql "$DATABASE_URL" -f src/migrations/077-marks-based-scoring.sql`
Then: `SELECT * FROM lesson_assignment_score_summaries('<a real lesson_id from your dev db>') LIMIT 10;`
Expected: rows with `percentage` between 0–100, matching `marks_awarded`/`max_marks` aggregation for that lesson's pupils.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/077-marks-based-scoring.sql
git commit -m "feat: rewrite lesson_assignment_score_summaries for marks-based aggregation"
```

---

## Task 3: Zod schemas — `src/types/index.ts`

**Files:**
- Modify: `src/types/index.ts:990-1004` (`LessonActivitySchema`)
- Modify: `src/types/index.ts:552-562` (`McqSubmissionBodySchema`)
- Modify: `src/types/index.ts:578-590` (`ShortTextSubmissionBodySchema`)
- Modify: `src/types/index.ts:809-821` (`GroupItemsSubmissionBodySchema`)
- Modify: `src/types/index.ts:886-896` (`ShortTextFeedbackResultSchema`)

**Interfaces:**
- Produces: `LessonActivitySchema.max_marks: z.number().int().min(1)`; a shared `marksFields` object spread into each submission body schema: `marks: z.number().int().min(0).nullable().optional()`, `auto_marks: z.number().int().min(0).nullable().optional()`, `marks_override: z.number().int().min(0).nullable().optional()`, plus `ai_marks`/`teacher_ai_marks` on the short-text schema specifically. Consumed by every server action in Tasks 4–6.

- [ ] **Step 1: Read current schemas for exact context**

Run: `sed -n '545,600p;805,900p;985,1005p' src/types/index.ts`

- [ ] **Step 2: Add `max_marks` to `LessonActivitySchema`**

In `src/types/index.ts`, inside the `LessonActivitySchema` object (around line 990), add:

```ts
  max_marks: z.number().int().min(1),
```

- [ ] **Step 3: Add marks fields to `McqSubmissionBodySchema`**

Around line 552, add alongside the existing `is_correct`/`teacher_override_score` fields:

```ts
  marks: z.number().int().min(0).nullable().optional(),
  auto_marks: z.number().int().min(0).nullable().optional(),
  marks_override: z.number().int().min(0).nullable().optional(),
```

- [ ] **Step 4: Add marks fields to `ShortTextSubmissionBodySchema`**

Around line 578, add:

```ts
  marks: z.number().int().min(0).nullable().optional(),
  auto_marks: z.number().int().min(0).nullable().optional(),
  ai_marks: z.number().int().min(0).nullable().optional(),
  teacher_ai_marks: z.number().int().min(0).nullable().optional(),
  marks_override: z.number().int().min(0).nullable().optional(),
```

- [ ] **Step 5: Add marks fields to `GroupItemsSubmissionBodySchema`**

Around line 809, add (this schema currently has bare `score`):

```ts
  marks: z.number().int().min(0).nullable().optional(),
  auto_marks: z.number().int().min(0).nullable().optional(),
  marks_override: z.number().int().min(0).nullable().optional(),
```

- [ ] **Step 6: Add `marks` to `ShortTextFeedbackResultSchema`**

Around line 886, alongside the existing `ai_score` field, add:

```ts
  marks: z.number().int().min(0).nullable().optional(),
```

- [ ] **Step 7: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: errors only in files that construct `LessonActivitySchema`-typed objects without `max_marks` (these get fixed in Task 7) — no errors inside `src/types/index.ts` itself.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add marks-based fields to activity and submission Zod schemas"
```

---

## Task 4: MCQ scoring write path

**Files:**
- Modify: `src/lib/server-actions/submissions.ts` (`upsertMcqSubmissionAction`, from line 771; `is_correct` computed at line 837; insert at lines 858-865)
- Modify: `src/lib/server-actions/submissions.ts` (`upsertMatcherSubmissionAction`, from line 918; `is_correct` at line 1004)

**Interfaces:**
- Consumes: `LessonActivitySchema.max_marks` (Task 3), `McqSubmissionBodySchema.marks`/`marks_override` (Task 3).
- Produces: submission body now includes `marks: is_correct ? activity.max_marks : 0` instead of relying solely on `is_correct` for downstream scoring.

- [ ] **Step 1: Read current implementation**

Run: `sed -n '771,870p' src/lib/server-actions/submissions.ts`

- [ ] **Step 2: Write/extend a Playwright test asserting marks are written on MCQ submit**

Add to `tests/worksheets/` or nearest existing MCQ-coverage spec (check `tests/` for an existing MCQ spec first with `grep -rl "multiple-choice" tests/`). If none exists, create `tests/scoring/mcq-marks.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('MCQ submission records whole-number marks based on activity max_marks', async ({ page }) => {
  // Reuses existing sign-in + navigate-to-assignment helpers from tests/.env.test setup.
  // Submit a correct MCQ answer for an activity with a known max_marks (e.g. 1),
  // then assert via the attempt detail UI that "1/1" (or activity-specific max) is shown,
  // not a raw percentage.
  // NOTE: fill in concrete selectors/navigation once the UI task (Task 8) lands —
  // this spec is written here so the assertion exists before the UI changes, per TDD,
  // but will not pass until Task 8's UI changes are complete.
});
```

- [ ] **Step 3: Update `upsertMcqSubmissionAction` to write `marks`**

At the point in `submissions.ts` (around line 837-840) where `is_correct` is computed, add immediately after:

```ts
  const isCorrect = mcqBody.correctOptionId === payload.optionId;
  const marksAwarded = isCorrect ? activity.max_marks : 0;
```

Then in the body object written to the DB (around line 858-865), add `marks: marksAwarded` alongside the existing `is_correct: isCorrect` field. `activity` here is the already-fetched `LessonActivitySchema`-typed row passed into the function — confirm it's in scope; if the function only fetches `activity_id`/`type`, extend its activity lookup query to also select `max_marks`.

- [ ] **Step 4: Apply the same change to `upsertMatcherSubmissionAction`**

Around line 1004, same pattern: compute `marksAwarded = isCorrect ? activity.max_marks : 0` and include `marks: marksAwarded` in the written body.

- [ ] **Step 5: Run the test suite for this file's existing coverage**

Run: `pnpm test -- --grep "mcq|matcher"` (adjust grep to match actual existing spec titles found via `grep -rl "mcq\|matcher" tests/`)
Expected: existing specs still pass (they assert on `is_correct`, which is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions/submissions.ts tests/
git commit -m "feat: write whole-number marks on MCQ and matcher submission"
```

---

## Task 5: Teacher override write paths

**Files:**
- Modify: `src/lib/server-actions/assignment-results.ts` (`resolveOverrideBody()`, lines 1571-1632; DB write lines 1644-1659)
- Modify: `src/lib/server-actions/short-text.ts` (`overrideShortTextSubmissionScoreAction`, lines 271-338; write at 311-319)

**Interfaces:**
- Consumes: `LessonActivitySchema.max_marks`, submission body `marks_override` field (Task 3).
- Produces: both override actions now accept and validate a whole-number `marksOverride` parameter (`0 ≤ marksOverride ≤ max_marks`) instead of a 0–1 or 0–100 fraction, and write it into `body.marks_override`.

- [ ] **Step 1: Read both current implementations**

Run: `sed -n '1571,1660p' src/lib/server-actions/assignment-results.ts && sed -n '271,338p' src/lib/server-actions/short-text.ts`

- [ ] **Step 2: Update `resolveOverrideBody()` signature and validation**

In `assignment-results.ts`, change the function's input parameter from a fraction/percentage `overrideScore` to `marksOverride: number`. Add validation before writing:

```ts
function resolveOverrideBody(existingBody: unknown, marksOverride: number, maxMarks: number): { data: SubmissionBody | null; error: string | null } {
  if (!Number.isInteger(marksOverride) || marksOverride < 0 || marksOverride > maxMarks) {
    return { data: null, error: `marksOverride must be a whole number between 0 and ${maxMarks}` };
  }
  // ... existing body-merging logic, but set body.marks_override = marksOverride
  // instead of body.teacher_override_score = overrideScore
}
```

Apply this validation+rename consistently through the rest of the function body, replacing every `teacher_override_score` reference with `marks_override`. The caller of this function (the exported server action) must now also accept `maxMarks` — fetch it from the `activities` row already being queried in that action, or extend the query to select `max_marks` if not already selected.

- [ ] **Step 3: Update `overrideShortTextSubmissionScoreAction`**

In `short-text.ts`, change the action's input Zod schema from a 0–1 fraction to:

```ts
  marksOverride: z.number().int().min(0),
```

Before the UPDATE write at line 311-319, fetch the activity's `max_marks` (the function should already be joining/selecting the activity row for `activity_id`; add `max_marks` to that select if missing) and validate:

```ts
  if (marksOverride > activity.max_marks) {
    return { data: null, error: `marksOverride cannot exceed ${activity.max_marks}` };
  }
```

Then write `marks_override: marksOverride` into the body instead of `teacher_override_score`.

- [ ] **Step 4: Find and update all callers**

Run: `grep -rn "resolveOverrideBody\|overrideShortTextSubmissionScoreAction" src/components src/lib`
Update each caller to pass a whole-number `marksOverride` (sourced from the new UI in Task 8) instead of a fraction.

- [ ] **Step 5: Run type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors in `assignment-results.ts` or `short-text.ts`; remaining errors (if any) are in UI callers, fixed in Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions/assignment-results.ts src/lib/server-actions/short-text.ts
git commit -m "feat: convert teacher override scoring to whole-number marks"
```

---

## Task 6: AI marking write path

**Files:**
- Modify: `src/lib/server-actions/short-text.ts` (`markShortTextActivityHelper`, lines 384-490; write at 460-477)
- Modify: `src/app/webhooks/ai-mark/route.ts` (lines around 538, 603)

**Interfaces:**
- Consumes: `LessonActivitySchema.max_marks`, `ShortTextSubmissionBodySchema.ai_marks`/`teacher_ai_marks` (Task 3).
- Produces: the AI marking prompt/response now produces a whole-number mark 0–`max_marks` directly, written to `body.ai_marks`, replacing the prior 0–1 fraction written to `ai_model_score`.

- [ ] **Step 1: Read current implementation**

Run: `sed -n '384,490p' src/lib/server-actions/short-text.ts`
Run: `sed -n '520,620p' src/app/webhooks/ai-mark/route.ts`

- [ ] **Step 2: Update the AI marking prompt to request whole-number marks**

In `markShortTextActivityHelper`, find where the prompt/instructions to the AI marking model are constructed (likely referencing `modelAnswer` and asking for a 0–1 score). Update the prompt text to state the question's `max_marks` (fetch from the activity row — extend the existing query if `max_marks` isn't already selected) and request an integer mark from 0 to `max_marks`, e.g.:

```ts
  const prompt = `This short-text question is worth ${activity.max_marks} marks. Award a whole number of marks from 0 to ${activity.max_marks} based on how well the pupil's answer matches the model answer. Respond with only the integer mark.`;
```

- [ ] **Step 3: Update response parsing**

Where the AI's numeric response is currently parsed and clamped to `[0, 1]`, change parsing to expect a whole-number string/integer and clamp to `[0, activity.max_marks]`:

```ts
  const parsedMarks = Math.round(Number(aiResponseText.trim()));
  const aiMarks = Number.isFinite(parsedMarks) ? Math.max(0, Math.min(activity.max_marks, parsedMarks)) : null;
```

- [ ] **Step 4: Update the DB write (lines 460-477)**

Replace the write of `ai_model_score: <fraction>` with `ai_marks: aiMarks` in the body object passed to the UPDATE.

- [ ] **Step 5: Apply the same prompt/parsing/write changes to the webhook handler**

In `src/app/webhooks/ai-mark/route.ts` around lines 538 and 603, mirror the same changes — this is the async counterpart of the synchronous helper and must stay consistent with it.

- [ ] **Step 6: Manually verify with a test submission**

Run the dev server (`pnpm dev`), submit a short-text-question answer as a pupil test account, trigger AI marking, and inspect the resulting `submissions.body` row via `psql` to confirm `ai_marks` is a whole number between 0 and the activity's `max_marks` (3 by default).

- [ ] **Step 7: Commit**

```bash
git add src/lib/server-actions/short-text.ts src/app/webhooks/ai-mark/route.ts
git commit -m "feat: convert AI marking to whole-number marks output"
```

---

## Task 7: Activity editor UI — `max_marks` field

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx` (near the `showScore` toggle, line 4420-4422, and wherever the activity create/edit form fields are defined)
- Modify: any server action that creates/updates activities (find via `grep -rn "LessonActivitySchema" src/lib/server-actions`)

**Interfaces:**
- Consumes: `LessonActivitySchema.max_marks` (Task 3).
- Produces: activity create/edit forms expose a "Marks available" whole-number input; the create/update server action persists it.

- [ ] **Step 1: Locate the activity create/edit form and its server action**

Run: `grep -rn "showScore\|is_summative" src/components/lessons/lesson-activities-manager.tsx | head -20`
Run: `grep -rln "LessonActivitySchema" src/lib/server-actions`

- [ ] **Step 2: Add the "Marks available" field to the form**

In the form component (react-hook-form + Zod resolver, per CLAUDE.md conventions), add a numeric input bound to `max_marks`, alongside the existing `showScore` checkbox:

```tsx
<FormField
  control={form.control}
  name="max_marks"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Marks available</FormLabel>
      <FormControl>
        <Input
          type="number"
          min={1}
          step={1}
          value={field.value}
          onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

Set the form's default value for `max_marks` based on activity type when creating a new activity: `1`, or `3` if `type === 'short-text-question'`.

- [ ] **Step 3: Update the create/update server action**

In the activity create/update server action found in Step 1, ensure `max_marks` is accepted in the input Zod schema (`.int().min(1)`) and included in the INSERT/UPDATE SQL for `activities`.

- [ ] **Step 4: Manually verify in the browser**

Start the dev server, open the lesson activities manager, create a new short-text-question activity, confirm the "Marks available" field defaults to 3 and is saved (check via `psql`: `SELECT max_marks FROM activities WHERE activity_id = '<new id>';`).

- [ ] **Step 5: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx src/lib/server-actions/
git commit -m "feat: add marks-available field to activity editor"
```

---

## Task 8: Teacher marking UI — whole-number marks input

**Files:**
- Modify: `src/components/assignment-results/assignment-results-dashboard.tsx` (score override inputs at lines 2877-2949 and 3990-4061, currently 0–100 scale)
- Modify: `src/components/lessons/activity-view/index.tsx` (STQ override panel at lines 2503-2570, currently 0–1 scale; `formatAverageScore` at lines 2582-2593)

**Interfaces:**
- Consumes: `resolveOverrideBody`/`overrideShortTextSubmissionScoreAction` now expecting whole-number `marksOverride` (Task 5).
- Produces: both override surfaces use a consistent whole-number marks input (`0` to activity's `max_marks`), resolving the existing 0–100 vs 0–1 scale inconsistency flagged during research.

- [ ] **Step 1: Read both current implementations**

Run: `sed -n '2877,2949p;3990,4061p' src/components/assignment-results/assignment-results-dashboard.tsx`
Run: `sed -n '2503,2593p' src/components/lessons/activity-view/index.tsx`

- [ ] **Step 2: Replace the 0–100 override inputs in `assignment-results-dashboard.tsx`**

At both the desktop (2877-2949) and mobile (3990-4061) input locations, change the numeric input's `min`/`max`/`step` from a 0–100 percentage to `min={0}`, `max={activity.max_marks}`, `step={1}`, and change the value transformation passed to the override action from `value / 100` (or however it currently converts to a fraction) to passing the raw integer `marksOverride` directly. Update the displayed label to show "out of {activity.max_marks}".

- [ ] **Step 3: Replace the 0–1 override input in `activity-view/index.tsx`**

At lines 2541-2553, change the input from a 0–1 fraction (likely `step={0.01}` or similar) to `min={0}`, `max={activity.max_marks}`, `step={1}`, passing the raw integer to `overrideShortTextSubmissionScoreAction`.

- [ ] **Step 4: Update `formatAverageScore` (lines 2582-2593)**

Change this function to operate on marks-based aggregation: given a list of `{ marksAwarded, maxMarks }` pairs (sourced from `compute_submission_marks` results returned by the relevant server action — extend that action's SELECT if it doesn't already return marks/max_marks), compute `(sum(marksAwarded) / sum(maxMarks)) * 100` for display as a percentage. Remove the existing per-type special-casing (MCQ as 0-1→percent vs other types as raw decimal) since marks aggregation is now type-agnostic.

- [ ] **Step 5: Manually verify in the browser**

Start the dev server, open the assignment results dashboard, override a submission's marks via both desktop and mobile views, confirm the value persists and displays consistently. Open the activity-view STQ override panel and confirm the same.

- [ ] **Step 6: Commit**

```bash
git add src/components/assignment-results/assignment-results-dashboard.tsx src/components/lessons/activity-view/index.tsx
git commit -m "feat: unify teacher marking UI on whole-number marks input"
```

---

## Task 9: Pupil-facing display — "marks / max_marks"

**Files:**
- Modify: `src/components/pupil/pupil-short-text-activity.tsx` (lines 74-77, `scoreLabel` computation)
- Modify: other `src/components/pupil/pupil-*-activity.tsx` components that compute `scoreLabel` (find via `grep -rl "scoreLabel" src/components/pupil`)

**Interfaces:**
- Consumes: submission body `marks`/`auto_marks`/`ai_marks`/`teacher_ai_marks`/`marks_override` fields and the parent activity's `max_marks` (passed as a prop into each pupil activity component — extend the prop type if `max_marks` isn't already threaded through).

- [ ] **Step 1: Find every pupil component computing `scoreLabel`**

Run: `grep -rln "scoreLabel" src/components/pupil`

- [ ] **Step 2: Update `pupil-short-text-activity.tsx`**

At lines 74-77, replace the fraction/percentage `scoreLabel` computation with:

```ts
const scoreLabel = marksAwarded != null ? `${marksAwarded}/${activity.max_marks}` : undefined;
```

Ensure `activity.max_marks` is available on the `activity` prop passed into this component (it now is, per `LessonActivitySchema` from Task 3) and that `marksAwarded` is sourced from the submission body's `marks`/`ai_marks`/`teacher_ai_marks`/`marks_override` (use the same priority order as `compute_submission_marks`, applied client-side, or — preferably — have the parent server component call `compute_submission_marks` in SQL and pass the resolved value down as a prop to avoid duplicating priority logic in TypeScript).

- [ ] **Step 3: Apply the same change to every other component found in Step 1**

For each, replace its fraction-to-percentage display logic with `${marksAwarded}/${maxMarks}`.

- [ ] **Step 4: Manually verify in the browser**

Sign in as a pupil test account, view feedback on a marked MCQ and a marked short-text-question, confirm both display as "x/y" (e.g. "1/1" and "2/3") rather than a percentage.

- [ ] **Step 5: Commit**

```bash
git add src/components/pupil/
git commit -m "feat: display marks-awarded/marks-available on pupil-facing views"
```

---

## Task 10: End-to-end verification

**Files:**
- None modified — verification only.

- [ ] **Step 1: Run the full Playwright suite**

Run: `pnpm test`
Expected: all specs pass, including the new `tests/scoring/mcq-marks.spec.ts` from Task 4 (now passing since Task 8's UI changes are complete) and any pre-existing scoring-related specs in `tests/worksheets/` or elsewhere.

- [ ] **Step 2: Run lint and type-check**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual full-flow smoke test**

Using the dev server: create a short-text-question activity (confirm default 3 marks), submit a pupil answer, trigger AI marking, confirm AI output is a whole number 0-3, override it as a teacher via both the assignment-results dashboard and the activity-view panel, confirm the pupil sees "x/3", and confirm the lesson report's aggregated percentage reflects `marks_awarded / max_marks` correctly (cross-check against a manual `SELECT * FROM lesson_assignment_score_summaries(...)` call).

- [ ] **Step 4: Commit any final fixes found during verification**

```bash
git add -A
git commit -m "fix: address issues found during marks-based scoring verification"
```
