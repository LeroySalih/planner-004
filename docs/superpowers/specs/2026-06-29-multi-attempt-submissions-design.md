# Multi-Attempt Submissions Design

## Problem

`submissions` currently holds at most one row per `(activity_id, user_id)`. Every resubmit
overwrites the previous row's `body` (score, feedback, answer) in place. There is no record
of earlier attempts, so:

- Pupils cannot see how they improved across attempts.
- Teachers cannot see what a pupil answered/scored on a prior attempt.
- There is no way to compute an "accuracy" metric (how many attempts it took to get the
  current score).

## Goals

- Every pupil submission to a scorable activity is preserved as a discrete, numbered attempt.
- An **accuracy** metric — `sum(attempt scores) / number of attempts` — is available
  alongside the current (latest) score wherever scores are shown.
- Teachers can view the full attempt history (score + feedback) for any pupil/activity pair
  from the results page.
- Teacher-initiated "request resubmission" stops zeroing the existing row and instead simply
  unlocks the pupil to submit a new attempt; the old attempt's score/feedback remains intact
  in history.
- No attempt cap — unlimited resubmits, matching current behavior.
- Applies to every scorable activity type: `multiple-choice-question`, `short-text-question`,
  `matcher`, `group-items`, `upload-worksheet`, `upload-spreadsheet`, long-text/task types.

## Non-Goals

- No max-attempts enforcement/configuration UI.
- No change to pupil-facing semantics of "current score" — it remains the latest attempt's
  score; accuracy is purely an additional, derived metric.
- No change to how scores are computed per activity type (MCQ correctness, AI short-text
  scoring, etc.) — only how attempts are stored and read.

## Data Model

### `submissions` table

Add a column:

```sql
ALTER TABLE public.submissions
  ADD COLUMN attempt_number integer;

-- Backfill: one existing row per (activity_id, user_id) today, so it is attempt 1.
UPDATE public.submissions SET attempt_number = 1 WHERE attempt_number IS NULL;

ALTER TABLE public.submissions
  ALTER COLUMN attempt_number SET NOT NULL,
  ALTER COLUMN attempt_number SET DEFAULT 1;

CREATE UNIQUE INDEX submissions_activity_user_attempt_uq
  ON public.submissions (activity_id, user_id, attempt_number);
```

`submission_id` remains the primary key (one per attempt row, not per activity/user pair).

### Resubmit-request tracking

`resubmit_requested` / `resubmit_note` currently live on the single submissions row and are
mutated in place alongside a body zero-out. Since each row is now an immutable historical
attempt, these flags move to a small dedicated table so they aren't attached to (and don't
pollute) attempt history:

```sql
CREATE TABLE public.submission_resubmit_requests (
  activity_id text NOT NULL,
  user_id text NOT NULL,
  requested boolean NOT NULL DEFAULT true,
  note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by text,
  PRIMARY KEY (activity_id, user_id)
);
```

- `requestResubmissionAction` upserts a row here (`requested = true`, `note = ...`) instead of
  mutating `submissions.body`. It does **not** touch any existing submission row.
- When the pupil's next attempt is inserted, the corresponding row in
  `submission_resubmit_requests` is deleted (or `requested` set to `false`) — the flag is
  "consumed."
- `submissions.resubmit_requested` / `submissions.resubmit_note` columns are dropped after all
  read paths are migrated to the new table (kept until then to avoid a big-bang cutover; see
  Migration Plan).

## Write Path — Attempt Insertion

Every submission action that currently does:

```sql
-- find existing row
select submission_id from submissions where activity_id = $1 and user_id = $2 order by submitted_at desc limit 1;
-- then either UPDATE that row or INSERT a fresh one
```

changes to:

```sql
select coalesce(max(attempt_number), 0) + 1 as next_attempt
from submissions
where activity_id = $1 and user_id = $2;
```

followed by an unconditional `INSERT ... (activity_id, user_id, attempt_number, body)` — the
`UPDATE` branch is deleted entirely. This applies to:

- `upsertMcqSubmissionAction`, `upsertMatcherSubmissionAction`,
  `upsertGroupItemsSubmissionAction` (`src/lib/server-actions/submissions.ts`)
- short-text submission write path (`src/lib/server-actions/short-text.ts`)
- long-text submission write path (`src/lib/server-actions/long-text.ts`)
- upload-url / upload-worksheet / upload-spreadsheet write paths
  (`src/lib/server-actions/upload-url.ts`, `lesson-activity-files.ts`)
- task submission write path (`src/lib/server-actions/tasks.ts`)

Each insert also deletes/clears the matching `submission_resubmit_requests` row for that
`(activity_id, user_id)` pair, consuming the unlock.

`is_flagged` resets to `false` on each new attempt (same as current behavior on resubmit).

## Read Path — "Latest" Lookups

Every place that currently reads "the submission" for an activity+user changes its ordering
from `submitted_at DESC` to `attempt_number DESC` (more robust — not subject to clock skew),
keeping `LIMIT 1` semantics:

- `getLatestSubmissionForActivityAction`
- `readSubmissionByIdAction` callers that assume "the" row
- `assignment-results.ts` cell-building queries
- `pupil-units.ts`
- `lib/scoring/activity-scores.ts` (`selectLatestSubmission`)

These continue to return exactly what they do today — the most recent attempt — so no
pupil-facing or teacher-cell-facing score logic changes other than the ordering column.

## Accuracy Metric

Wherever a per-(activity, user) score is computed from submission rows, also compute:

```
accuracy = sum(score for every attempt by this user on this activity) / (count of attempts)
```

using the same per-activity-type score extraction logic already in place (the
`extractScoreFromSubmission` / inline scoring used in `readLessonSubmissionSummariesAction`
and `assignment-results.ts`), applied to *all* attempt rows for that user+activity instead of
just the latest one.

- `LessonSubmissionSummary` (and its Zod schema) gains an `accuracy: number | null` field per
  score entry, alongside the existing `score`.
- The assignment-results cell type gains `accuracy: number | null` alongside `score`.
- Attempts with a non-numeric/unscored body are excluded from both the numerator and
  denominator (consistent with how missing scores are already filtered elsewhere).
- If only one attempt exists, `accuracy === score` (the formula degenerates correctly — no
  special-casing needed).

Display: wherever score is rendered as a percentage (`formatPercent` in
`assignment-results-dashboard.tsx`, pupil-facing result views), show accuracy next to it, e.g.
`Score: 100% · Accuracy: 50% (2 attempts)`.

## Teacher Results View — Attempt History

New server action:

```ts
export async function readSubmissionAttemptsAction(
  activityId: string,
  userId: string,
): Promise<{ data: SubmissionAttempt[]; error: string | null }>
```

Returns every `submissions` row for that `(activity_id, user_id)` pair, ordered
`attempt_number ASC`, each parsed through the same per-activity-type body schema already used
for the current/latest submission (`McqSubmissionBodySchema`, `ShortTextSubmissionBodySchema`,
etc.), so feedback/score extraction logic is reused rather than duplicated.

UI: in `assignment-results-dashboard.tsx`, the existing pupil/activity detail `Sheet` (which
already has tabs like "Automatic score") gains an "Attempts" tab. It lists every attempt
newest-first: attempt number, score, feedback (auto and/or teacher), and the pupil's answer
where the existing per-type renderers already know how to display it (reuse, don't
reimplement, the existing answer-rendering snippets used for the latest submission). The
overall accuracy for that activity+user is shown as a summary line above the list.

## Migration Plan (ordering, to avoid breaking prod mid-deploy)

1. Ship the additive schema migration (`attempt_number` column + backfill + unique index;
   new `submission_resubmit_requests` table). No behavior change yet — old columns stay.
2. Switch all write paths from update-existing to insert-new-attempt, and switch
   `requestResubmissionAction` to the new tracking table. Switch all "latest" read paths to
   order by `attempt_number`.
3. Add accuracy computation to summary/results read paths and surface it in the UI.
4. Add the attempts-history server action and the "Attempts" tab in the teacher results UI.
5. Once verified in production, a follow-up migration drops
   `submissions.resubmit_requested` / `submissions.resubmit_note` (no longer written or read).

## Testing

- No unit test infra in this repo; verification is via Playwright E2E (existing patterns in
  `tests/`) plus manual exercise of: submit → resubmit → resubmit again → confirm 3 rows
  exist, latest score/feedback shown matches attempt 3, accuracy matches
  `(s1+s2+s3)/3`, and the teacher Attempts tab lists all three in order.
- Existing Playwright specs touching submission/resubmit flows
  (`tests/` — grep for `resubmit`, `submission`) must continue to pass since pupil-facing
  "current attempt" behavior is unchanged.
