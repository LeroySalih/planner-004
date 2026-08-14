# Multi-SC Marking Implementation Plan

> **For Claude:** Implement this plan task-by-task. Each task ends with a
> verification step — do not advance until it passes.

**Goal:** Replace whole-activity AI marking with per-success-criterion marking.
Every SC becomes binary (0–1) or levelled (0–n descriptors). Activities fan out
one model call per SC; results are gathered and summed into the activity score.

**Architecture:** DINO coordinates the fan-out via the existing `external_jobs`
queue — one job per (submission, SC). n8n executed each model call when this was
written; it was removed on 2026-08-14 and the worker now calls Gemini directly
(see `docs/plans/2026-08-13-direct-model-calls.md`). A new `submission_sc_marks` table is the
authoritative per-criterion store; a cached normalised aggregate is written to
`submissions.body` so all existing SQL reporting keeps working unchanged.

**Decisions doc:** `docs/plans/multi-sc-open-questions.md` — 11 questions
answered; read it before starting.

**Worktree:** `.worktrees/multi-sc` — dev server at http://localhost:3001,
database `postgres-multi-sc`.

---

## STATUS: Tasks 1–11 implemented (2026-08-11)

Build and typecheck clean. Migrations `081` and `082` applied to the worktree DB.

**Corrections made during implementation** (the plan as written was wrong on
these; the decisions doc records the reasoning):

- **Task 2** said to delete `normaliseSuccessCriteriaScores`. It has 74 call
  sites across 13 files, almost all legitimate initialisation. Kept it; added
  the weighted helpers alongside and removed only the three genuine uniform-fill
  sites.
- **Task 3** backfill was destructive as specified — it would have dropped 286
  STQs from 3 marks to 1. Resolved by Q12/Q13: convert those criteria to
  levelled(3), cap deterministic types at 1 mark, exclude non-scorable types.
  Both steps live in migration `082`, not a script, so they apply to production.
- **Task 5** listed three queue bugs. There was a fourth and worse one: the
  claim was an `UPDATE submissions ... FROM (picked jobs)`, and Postgres updates
  a target row at most once per statement, so N criterion jobs on one submission
  collapsed to a SINGLE claim and the rest were silently dropped. The claim now
  targets `external_jobs`.
- **Tasks 5 and 6** were merged — fanning out without criterion-specific
  payloads would send N identical requests.
- **Task 10** targeted `ActivityProgressPanel`, which is dead code.
  `LiveActivityShell` is the live pupil surface and now carries the breakdown.

**Not done at the time of writing** (all since resolved):
- The n8n workflow never echoed `success_criteria_id` back. Superseded — n8n was
  removed and the worker calls the model directly, so the criterion is known
  without a round trip.
- `do-flashcards` is in `DETERMINISTIC_ACTIVITY_TYPES` for the max_marks cap but
  has no upsert in `submissions.ts`; its criteria get no propagated rows.
- No UI has been visually reviewed — all teacher/pupil surfaces are auth-gated.

**Apply migrations with:**
```bash
docker exec -i postgres17 psql -U leroy -d postgres-multi-sc < src/migrations/081-multi-sc.sql
```
(`psql` is not installed on the host; the `postgres` role does not exist in the
container — use `-U leroy`.)

---

## Structural problems this plan must solve

Three things in the current queue break under fan-out. Each is addressed in the
task where it bites, but they are listed here because they are non-obvious.

**1. The claim query gates on `mark_status`, which serialises SC jobs.**
`processNextQueueItem` (`marking-queue.ts:124`) claims work with
`sub.mark_status = 'waiting'` and sets it to `'marking'`. With three SC jobs for
one submission, the first claim flips the status and the other two become
permanently unclaimable. SC jobs must be claimed on the job row's own status.

**2. `enqueueAiMarkJob` deletes by submission id.**
Line 100 deletes any pending job where `payload->>'submissionId'` matches, to
enforce one job per submission. Under fan-out this means enqueuing SC 2 deletes
SC 1's job. The dedupe key becomes (submissionId, successCriteriaId).

**3. `resolveQueueItem(submissionId)` resolves every job for a submission.**
Line 570 marks all matching jobs `done`. It must resolve only the criterion whose
callback arrived.

---

### Task 1: DB Migration — schema and legacy backfill

**Files:**
- Create: `src/migrations/081-multi-sc.sql`

**Step 1: Write the migration**

```sql
-- SC type: binary (0-1) or levelled (0-n descriptors)
ALTER TABLE success_criteria
  ADD COLUMN IF NOT EXISTS sc_type text NOT NULL DEFAULT 'binary';

ALTER TABLE success_criteria
  DROP CONSTRAINT IF EXISTS success_criteria_sc_type_check;
ALTER TABLE success_criteria
  ADD CONSTRAINT success_criteria_sc_type_check
  CHECK (sc_type IN ('binary', 'levelled'));

-- Ascending descriptors for levelled SCs. level_index is 1..n; a pupil may
-- score 0 (no descriptor met) through n (top descriptor met).
CREATE TABLE IF NOT EXISTS success_criteria_descriptors (
  success_criteria_id text NOT NULL
    REFERENCES success_criteria(success_criteria_id) ON DELETE CASCADE,
  level_index         integer NOT NULL CHECK (level_index >= 1),
  descriptor          text NOT NULL,
  PRIMARY KEY (success_criteria_id, level_index)
);

-- Authoritative per-criterion marks. provenance distinguishes real AI
-- assessment from teacher edits and from pre-cutover migrated uniform fill.
CREATE TABLE IF NOT EXISTS submission_sc_marks (
  submission_id       text NOT NULL,
  success_criteria_id text NOT NULL
    REFERENCES success_criteria(success_criteria_id) ON DELETE CASCADE,
  awarded             integer NOT NULL CHECK (awarded >= 0),
  available           integer NOT NULL CHECK (available >= 1),
  feedback            text,
  provenance          text NOT NULL DEFAULT 'ai'
    CHECK (provenance IN ('ai', 'teacher', 'legacy')),
  marked_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (submission_id, success_criteria_id),
  CHECK (awarded <= available)
);

CREATE INDEX IF NOT EXISTS idx_submission_sc_marks_sc
  ON submission_sc_marks (success_criteria_id, submission_id);
```

**Step 2: Backfill legacy per-SC data (Q10)**

Existing `body.success_criteria_scores` holds normalised 0–1 values, uniform
filled. Every SC is `binary` at this point (the column default), so
`available = 1` and `awarded = round(score)`.

```sql
INSERT INTO submission_sc_marks
  (submission_id, success_criteria_id, awarded, available, provenance, marked_at)
SELECT
  s.submission_id,
  kv.key,
  LEAST(1, GREATEST(0, ROUND((kv.value #>> '{}')::numeric)))::integer,
  1,
  'legacy',
  COALESCE(s.submitted_at, timezone('utc', now()))
FROM submissions s
CROSS JOIN LATERAL jsonb_each((s.body::jsonb)->'success_criteria_scores') AS kv
WHERE s.body::jsonb ? 'success_criteria_scores'
  AND jsonb_typeof((s.body::jsonb)->'success_criteria_scores') = 'object'
  AND kv.key IN (SELECT success_criteria_id FROM success_criteria)
  AND jsonb_typeof(kv.value) = 'number'
ON CONFLICT (submission_id, success_criteria_id) DO NOTHING;
```

The `kv.key IN (SELECT …)` guard is required — the FK would otherwise reject rows
referencing SCs deleted since the submission was marked.

**Step 3: Apply and verify**

```bash
docker exec -i postgres17 psql -U leroy -d postgres-multi-sc < src/migrations/081-multi-sc.sql
docker exec -i postgres17 psql -U leroy -d postgres-multi-sc -c \
  "select provenance, count(*) from submission_sc_marks group by 1;"
```

**Verify:** the table exists, the `legacy` count is non-zero, and no row violates
`awarded <= available`.

---

### Task 2: Types and the scoring core

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/scoring/success-criteria.ts`

**Step 1: Zod schemas**

Add to `src/types/index.ts`:

```ts
export const ScTypeSchema = z.enum(["binary", "levelled"])

export const SuccessCriterionDescriptorSchema = z.object({
  levelIndex: z.number().int().min(1),
  descriptor: z.string().min(1),
})

export const SubmissionScMarkSchema = z.object({
  successCriteriaId: z.string(),
  awarded: z.number().int().min(0),
  available: z.number().int().min(1),
  feedback: z.string().nullable().default(null),
  provenance: z.enum(["ai", "teacher", "legacy"]),
})
```

Extend the existing success-criteria schemas with `scType` and `descriptors`.

**Step 2: Replace the averaging helper**

`computeAverageSuccessCriteriaScore` takes an unweighted mean, which is wrong
under this model — a 3-level SC must count three times a binary one. Delete it
and its call sites (per the repo's no-backwards-compatibility rule) and add:

```ts
/** Marks a criterion contributes: 1 for binary, n for levelled. */
export function criterionAvailableMarks(
  scType: "binary" | "levelled",
  descriptorCount: number,
): number {
  return scType === "levelled" ? Math.max(1, descriptorCount) : 1
}

/**
 * Weighted total across a submission's criteria. Returns the normalised 0-1
 * score expected by compute_submission_base_score, plus the raw marks for
 * display. Returns null when there are no criteria.
 */
export function computeScAggregate(
  marks: Array<{ awarded: number; available: number }>,
): { normalised: number; awarded: number; available: number } | null {
  if (marks.length === 0) return null
  const awarded = marks.reduce((sum, m) => sum + m.awarded, 0)
  const available = marks.reduce((sum, m) => sum + m.available, 0)
  if (available === 0) return null
  return { normalised: awarded / available, awarded, available }
}
```

**Step 3:** Delete `normaliseSuccessCriteriaScores`. Its only purpose was the
uniform fill this feature removes. Every call site is rewritten in Tasks 6–8.

**Verify:** `pnpm lint` passes and `npx tsc --noEmit` reports no errors other
than the call sites scheduled for later tasks.

---

### Task 3: Derived `max_marks`

**Files:**
- Create: `src/lib/scoring/derive-max-marks.ts`
- Modify: `src/lib/server-actions/lesson-activities.ts`
- Modify: `src/lib/server-actions/curricula.ts`
- Modify: `src/lib/mcp/activities.ts`

**Step 1: The recalculation helper**

```ts
/**
 * Recalculate max_marks for an activity from its linked SCs. Activities with no
 * SCs keep their manually-set value and are left untouched.
 */
export async function recalculateActivityMaxMarks(
  client: PoolClient,
  activityId: string,
): Promise<void> {
  await client.query(
    `update activities a
     set max_marks = totals.available
     from (
       select acs.activity_id,
              sum(case when sc.sc_type = 'levelled'
                       then greatest(1, (select count(*) from success_criteria_descriptors d
                                          where d.success_criteria_id = sc.success_criteria_id))
                       else 1 end)::int as available
       from activity_success_criteria acs
       join success_criteria sc on sc.success_criteria_id = acs.success_criteria_id
       where acs.activity_id = $1
       group by acs.activity_id
     ) totals
     where a.activity_id = totals.activity_id`,
    [activityId],
  )
}
```

**Step 2: Call it from every mutation that changes the inputs**

| Surface | Location | Trigger |
|---|---|---|
| Activity create with SCs | `lesson-activities.ts:272` | after the SC insert |
| Activity SC update | `lesson-activities.ts:500` | after the reinsert |
| Activity SC bulk insert | `lesson-activities.ts:742` | after insert |
| MCP add SC | `mcp/activities.ts:323` | after insert |
| MCP remove SC | `mcp/activities.ts:371` | after delete |
| SC type change | `curricula.ts` update path | fan out to **all** affected activities |
| Descriptor add/remove | curricula descriptor actions | fan out to **all** affected activities |

The last two are the ones easy to miss — an SC is shared, so changing its type or
descriptor count changes `max_marks` on every activity linked to it. Add a
sibling helper that recalculates by `success_criteria_id`.

**Step 3:** Backfill existing activities once, via a script under `scripts/`.

**Verify:** attach a levelled SC with 3 descriptors plus a binary SC to a test
activity, confirm `max_marks` becomes 4, remove a descriptor and confirm it
becomes 3.

---

### Task 4: Curriculum builder — type toggle and descriptor editor

**Files:**
- Modify: `src/app/curriculum/[curriculumId]/curriculum-prototype-client.tsx` (2730 lines)
- Modify: `src/lib/server-actions/curricula.ts` (1610 lines)

**Step 1: Server actions.** Extend the SC create/update actions to carry
`sc_type`, and add descriptor CRUD (add, update text, remove, reorder). Reordering
rewrites `level_index` contiguously from 1.

**Step 2: UI.** Each SC row gains a binary/levelled control. Selecting *levelled*
reveals an ordered descriptor list — add, edit, remove, drag to reorder —
rendered lowest-to-highest to match how they will be assessed.

**Step 3:** Switching levelled → binary must warn that descriptors will be
deleted and `max_marks` will change on every activity using this criterion.
Show the affected activity count in the confirmation.

**Verify:** author a 3-descriptor levelled SC, reload, confirm order persists.
Switch it to binary and confirm the warning names the right activity count.

---

### Task 5: Fan-out — one job per (submission, SC)

**Files:**
- Modify: `src/lib/ai/marking-queue.ts`

This task fixes structural problems 1–3 above.

**Step 1: `enqueueMarkingTasks` fans out.** For each submission, load the
activity's SCs. If there are none, enqueue a single job exactly as today. If
there are SCs, set `mark_status='waiting'` once and enqueue one job per
criterion, each with `successCriteriaId` in the payload.

**Step 2: `enqueueAiMarkJob` dedupes on the pair.**

```sql
delete from external_jobs
 where job_type='ai_mark' and status in ('pending','processing')
   and payload->>'submissionId' = $1
   and payload->>'successCriteriaId' is not distinct from $2
```

`is not distinct from` handles the no-SC case where the value is null.

**Step 3: The claim query stops gating on `mark_status`.** Claim purely on the
job row (`j.status='pending' and j.process_after <= now() and j.attempts <
j.max_attempts`), and set `mark_status='marking'` once at enqueue time rather
than per claim. Without this, only one SC per submission is ever claimed.

**Step 4: `resolveQueueItem` becomes per-criterion** — takes
`(submissionId, successCriteriaId)` and resolves only that job.

**Step 5: `recoverStuckItems`** must not reset a submission to `'waiting'` while
sibling SC jobs are still in flight. Reset only the job rows; derive the
submission status from whether any job for it remains unresolved.

**Verify:** enqueue a 3-SC submission, confirm three `external_jobs` rows exist
and all three reach `processing` — not one.

---

### Task 6: n8n request contract

**Files:**
- Modify: `src/lib/ai/ai-marking-client.ts`
- Modify: `src/lib/ai/marking-queue.ts` (the `doParams` construction)
- Modify: `docs/n8n/` flow definition

**Step 1:** Add to `ShortTextMarkingParams`:

```ts
success_criteria_id: string
sc_type: "binary" | "levelled"
sc_description: string
descriptors: string[]     // empty for binary
max_marks: number         // this criterion's available marks, not the activity's
```

Note `max_marks` changes meaning per call: it is now the *criterion's* ceiling.

**Step 2:** Build these in `processSingleItem` from the job's
`successCriteriaId`. Keep the `markingFieldOrNotSet` convention for empty fields.

**Step 3: The prompt must state that 0 is valid** (Q3) and what it means, or the
model anchors to the lowest descriptor and never returns 0.

**Step 4:** Update the n8n workflow to include the criterion in its prompt and
echo `success_criteria_id` back in each result.

**Verify:** trigger one submission, inspect `ai_marking_logs` for one logged
request per SC, each with a distinct `success_criteria_id`.

---

### Task 7: Callback and gather

**Files:**
- Modify: `src/lib/ai/apply-ai-mark.ts`
- Create: `src/lib/scoring/aggregate-sc-marks.ts`

The most delicate task — concurrent callbacks for the same submission will race.

**Step 1:** `ResultEntrySchema` gains an optional `success_criteria_id`. When
present, the result is a per-criterion mark; when absent, the existing
whole-activity path runs unchanged (for activities with no SCs).

**Step 2: The gather, in one transaction.**

```
BEGIN
  upsert submission_sc_marks (on conflict … do update)   -- idempotent replay
  SELECT … FROM submissions WHERE submission_id = $1 FOR UPDATE   -- serialise
  count completed SC rows vs the activity's SC count
  IF complete:
    aggregate := computeScAggregate(rows)
    write body.ai_model_score  = aggregate.normalised   -- 0-1, what SQL reads
    write body.sc_marks_awarded / body.sc_marks_available -- raw, for display
    set mark_status = 'marked'
    emit SSE
COMMIT
```

The `FOR UPDATE` on the submission row is what makes concurrent callbacks safe —
`processNextQueueItem` runs a batch of 5 through `Promise.allSettled`, so two SC
callbacks for one submission will arrive together.

**Step 3: Teacher-edited rows are preserved.** The upsert must not overwrite a
row with `provenance='teacher'`; add `where submission_sc_marks.provenance <>
'teacher'` to the `do update`.

**Step 4:** Delete the uniform-fill code at `apply-ai-mark.ts:377` and `:435`.

**Step 5: Aggregate storage.** `compute_submission_base_score` returns a clamped
0–1 value and reads `ai_model_score` for `short-text-question`. Writing the
normalised aggregate there means every existing report, RPC and dashboard keeps
working with no SQL change. `submission_sc_marks` stays authoritative; the body
value is a cache, recomputed whenever a criterion row changes.

**Verify:** mark a 3-SC submission end to end. Confirm three rows, one aggregate
matching their weighted sum, and `mark_status='marked'` exactly once. Then replay
the same callback and confirm nothing changes.

---

### Task 8: Deterministic activity types

**Files:**
- Modify: `src/lib/server-actions/submissions.ts`

12 of the 16 scorable types never reach a model (Q6b). Where such an activity has
SCs attached, propagate its own result: correct → `awarded = available` for every
criterion, incorrect → `awarded = 0`. Write with `provenance='ai'` and no
feedback.

This is uniform fill by design — recorded as an accepted limitation in the
decisions doc. It is meaningful for coverage reporting, not diagnostics.

**Verify:** answer an MCQ with 1 binary + 1 levelled(3) SC correctly. Confirm
`max_marks = 4`, both rows at full marks, aggregate 1.0.

---

### Task 9: Per-SC teacher override

**Files:**
- Create: `src/lib/server-actions/sc-marks.ts`
- Modify: `src/components/assignment-results/assignment-results-dashboard.tsx` (4450 lines)

**Step 1:** `updateScMarkAction(submissionId, successCriteriaId, awarded)` —
`requireRole('teacher')`, validate `0 <= awarded <= available`, write with
`provenance='teacher'`, then recompute the aggregate through the same helper as
Task 7. The aggregate is always the sum of its parts (Q7); there is no separate
whole-activity override.

**Step 2:** Per-criterion editor in the marking dashboard — a 0/1 toggle for
binary, a level picker for levelled, showing the descriptor at each level.
Teacher-edited criteria are visually marked so a re-mark's preservation of them
is predictable.

**Step 3:** Review `teacher_override_score` / `teacher_ai_score` handling in
`compute_submission_base_score`. For SC-scored activities the sum is
authoritative, so the override branch must not silently win over it.

**Verify:** override one criterion, confirm the total recomputes. Retrigger
marking and confirm the teacher value survives while the others are refreshed.

---

### Task 10: Per-SC feedback display

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx`
- Modify: `src/components/assignment-results/assignment-results-dashboard.tsx`
- Modify: `src/lib/feedback/pupil-activity-feedback.ts`

**Step 1:** Pupils and teachers both see a per-criterion breakdown: criterion
description, marks awarded of available, the model's comment, and for levelled
SCs the descriptor achieved.

**Step 2:** `insertPupilActivityFeedbackEntry` currently writes one row per
submission. Keep that shape and pass the concatenated per-criterion feedback —
the criterion-level detail lives in `submission_sc_marks` and is read from there
for display. This avoids reshaping the feedback history table.

**Verify:** as a pupil, view a marked 3-SC activity and confirm three criteria
each show their own mark and comment.

---

### Task 11: End-to-end verification

**Step 1:** Author a curriculum SC of each type. Attach both to a
`short-text-question`. Confirm derived `max_marks`.

**Step 2:** Submit as a pupil, watch three jobs fan out, confirm the aggregate.

**Step 3:** Failure path — force one SC's job to exhaust its attempts. Confirm
`mark_status='marking-error'`, no aggregate written, and that the succeeded rows
persist so a retrigger re-runs only the failed criterion (Q5).

**Step 4:** `pnpm lint` and `pnpm build` clean.

**Step 5:** Per CLAUDE.md — run `git status` in the worktree and `git add` every
new file before committing. Untracked files are invisible to a merge and will
break the production build.

---

## Deployment note — **superseded by migration 084**

This originally said to drain the queue by hand before deploying. That is now
migration `084-drain-n8n-marking-queue.sql`, which runs in sequence with the
rest and requeues in-flight work for the direct-call worker rather than making
anyone watch a counter.

Apply in order: `081` → `082` → `083` → `084`.
