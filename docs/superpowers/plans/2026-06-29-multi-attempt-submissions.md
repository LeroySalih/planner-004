# Multi-Attempt Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pupil submission to a scorable activity becomes a new, permanently-kept attempt row instead of overwriting the previous one, with an accuracy metric (`sum(attempt scores) / attempt count`) and a teacher-facing attempt-history view.

**Architecture:** Add `attempt_number` to `submissions` (insert-only from now on, unique per `(activity_id, user_id, attempt_number)`). Move the "teacher requested a resubmit" flag off the submissions row into a new `submission_resubmit_requests` table, since attempt rows are now immutable history. All "latest submission" reads switch from `ORDER BY submitted_at DESC` to `ORDER BY attempt_number DESC`. A shared helper module centralizes attempt-number allocation and resubmit-request bookkeeping so every write path (MCQ, matcher, group-items, short-text, long-text, upload-url, upload-worksheet/spreadsheet) uses the same logic.

**Tech Stack:** Next.js 15 server actions, `pg` (raw SQL via `src/lib/db.ts`), Zod schemas in `src/types/index.ts`, React 19 components.

## Global Constraints

- Two-space indentation throughout (per CLAUDE.md).
- Server actions validate with Zod, wrap DB calls in try/catch, return `{ data, error }` shape.
- No backwards-compatibility hacks — delete the old UPDATE branches entirely, don't leave them dead/commented.
- Nullable boolean columns: use `IS NOT FALSE`, not `= true`, when filtering (per CLAUDE.md SQL Gotchas) — not directly relevant here but keep in mind for any new queries touching `active`.
- Migrations live in `src/migrations/` as new numbered/dated `.sql` files — follow existing naming (e.g. `068-add-submission-comments.sql`).
- Run `pnpm lint` after each task that touches TypeScript.

---

### Task 1: Migration — `attempt_number` column and `submission_resubmit_requests` table

**Files:**
- Create: `src/migrations/072-submission-attempts.sql`

**Interfaces:**
- Produces: `submissions.attempt_number integer NOT NULL DEFAULT 1`, unique index `submissions_activity_user_attempt_uq` on `(activity_id, user_id, attempt_number)`; new table `submission_resubmit_requests(activity_id text, user_id text, requested boolean, note text, requested_at timestamptz, requested_by text)` with PK `(activity_id, user_id)`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 072-submission-attempts.sql
ALTER TABLE public.submissions
  ADD COLUMN attempt_number integer;

UPDATE public.submissions SET attempt_number = 1 WHERE attempt_number IS NULL;

ALTER TABLE public.submissions
  ALTER COLUMN attempt_number SET NOT NULL,
  ALTER COLUMN attempt_number SET DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_activity_user_attempt_uq
  ON public.submissions (activity_id, user_id, attempt_number);

CREATE TABLE IF NOT EXISTS public.submission_resubmit_requests (
  activity_id text NOT NULL,
  user_id text NOT NULL,
  requested boolean NOT NULL DEFAULT true,
  note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by text,
  PRIMARY KEY (activity_id, user_id)
);
```

- [ ] **Step 2: Apply the migration to the local dev database**

Run: `psql "$DATABASE_URL" -f src/migrations/072-submission-attempts.sql`
Expected: `ALTER TABLE`, `UPDATE 0` (or N existing rows), `ALTER TABLE`, `CREATE INDEX`, `CREATE TABLE` — no errors.

- [ ] **Step 3: Verify the column and table exist**

Run: `psql "$DATABASE_URL" -c "\d submissions" && psql "$DATABASE_URL" -c "\d submission_resubmit_requests"`
Expected: `attempt_number | integer | not null | default 1` listed under `submissions`; `submission_resubmit_requests` table listed with the 6 columns above.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/072-submission-attempts.sql
git commit -m "feat: add attempt_number to submissions and submission_resubmit_requests table"
```

---

### Task 2: Zod schema updates

**Files:**
- Modify: `src/types/index.ts:187-205`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SubmissionSchema` now includes `attempt_number: number`; new exported `SubmissionResubmitRequestSchema` and `SubmissionResubmitRequest` type for the new table's rows.

- [ ] **Step 1: Add `attempt_number` to `SubmissionSchema` and define the resubmit-request schema**

Replace `src/types/index.ts:187-205`:

```ts
export const SubmissionSchema = z.object({
    submission_id: z.string(),
    activity_id: z.string(),
    user_id: z.string(),
    attempt_number: z.number().int().min(1),
    submitted_at: z
        .union([z.string(), z.date()])
        .transform((
            value,
        ) => (value instanceof Date ? value.toISOString() : value)),
    body: z.unknown().nullable().default(null),
    is_flagged: z.boolean().default(false),
    resubmit_requested: z.boolean().default(false),
    resubmit_note: z.string().nullable().optional(),
});

export const SubmissionsSchema = z.array(SubmissionSchema);

export type Submission = z.infer<typeof SubmissionSchema>;
export type Submissions = z.infer<typeof SubmissionsSchema>;

export const SubmissionResubmitRequestSchema = z.object({
    activity_id: z.string(),
    user_id: z.string(),
    requested: z.boolean(),
    note: z.string().nullable().optional(),
    requested_at: z
        .union([z.string(), z.date()])
        .transform((
            value,
        ) => (value instanceof Date ? value.toISOString() : value)),
    requested_by: z.string().nullable().optional(),
});

export type SubmissionResubmitRequest = z.infer<
    typeof SubmissionResubmitRequestSchema
>;
```

> Note: `resubmit_requested` / `resubmit_note` stay on `SubmissionSchema` for now since the column isn't dropped until Task 14 — but after Task 9 nothing writes to it via the old path anymore. `SubmissionSchema.parse` will keep defaulting it to `false` from the raw `submissions` row, which is fine since the row's value is now frozen at insert time (always `false`) and the real flag lives in `submission_resubmit_requests`.

- [ ] **Step 2: Run lint to confirm no type errors elsewhere from the new required field**

Run: `pnpm lint`
Expected: no new errors related to `SubmissionSchema` (existing call sites all read `submission_id`/`body`/etc. via the parsed object, none construct a `Submission` literal by hand — confirm with `grep -rn "attempt_number" src | wc -l` returning 0 before this step, meaning nothing yet depends on it).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add attempt_number and SubmissionResubmitRequestSchema to types"
```

---

### Task 3: Shared attempt-tracking helper module

**Files:**
- Create: `src/lib/server-actions/submission-attempts.ts`
- Test: manual (exercised by later tasks; this module has no UI/route of its own)

**Interfaces:**
- Consumes: `query` from `@/lib/db`.
- Produces:
  - `getNextAttemptNumber(activityId: string, userId: string): Promise<number>`
  - `clearResubmitRequest(activityId: string, userId: string): Promise<void>`
  - `setResubmitRequest(input: { activityId: string; userId: string; note: string | null; requestedBy: string | null }): Promise<void>`
  - `getResubmitRequest(activityId: string, userId: string): Promise<{ requested: boolean; note: string | null } | null>`

- [ ] **Step 1: Write the module**

```ts
// src/lib/server-actions/submission-attempts.ts
"use server";

import { query } from "@/lib/db";

export async function getNextAttemptNumber(
  activityId: string,
  userId: string,
): Promise<number> {
  const { rows } = await query<{ next_attempt: number }>(
    `
      select coalesce(max(attempt_number), 0) + 1 as next_attempt
      from submissions
      where activity_id = $1 and user_id = $2
    `,
    [activityId, userId],
  );
  return rows[0]?.next_attempt ?? 1;
}

export async function clearResubmitRequest(
  activityId: string,
  userId: string,
): Promise<void> {
  await query(
    `delete from submission_resubmit_requests where activity_id = $1 and user_id = $2`,
    [activityId, userId],
  );
}

export async function setResubmitRequest(input: {
  activityId: string;
  userId: string;
  note: string | null;
  requestedBy: string | null;
}): Promise<void> {
  await query(
    `
      insert into submission_resubmit_requests (activity_id, user_id, requested, note, requested_by)
      values ($1, $2, true, $3, $4)
      on conflict (activity_id, user_id)
      do update set requested = true, note = $3, requested_by = $4, requested_at = now()
    `,
    [input.activityId, input.userId, input.note, input.requestedBy],
  );
}

export async function getResubmitRequest(
  activityId: string,
  userId: string,
): Promise<{ requested: boolean; note: string | null } | null> {
  const { rows } = await query<{ requested: boolean; note: string | null }>(
    `
      select requested, note
      from submission_resubmit_requests
      where activity_id = $1 and user_id = $2
    `,
    [activityId, userId],
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/submission-attempts.ts
git commit -m "feat: add submission-attempts helper for attempt numbering and resubmit tracking"
```

---

### Task 4: Convert `submissions.ts` write paths to insert-only attempts

**Files:**
- Modify: `src/lib/server-actions/submissions.ts:743-1452` (the three `upsertXSubmissionAction` functions)

**Interfaces:**
- Consumes: `getNextAttemptNumber`, `clearResubmitRequest` from `@/lib/server-actions/submission-attempts`.
- Produces: same external signatures/return shapes as before (`{ success, error, data }`), unchanged for callers.

- [ ] **Step 1: Import the helpers**

Add to the top of `src/lib/server-actions/submissions.ts` (after the existing imports, e.g. after line 31):

```ts
import {
  clearResubmitRequest,
  getNextAttemptNumber,
} from "@/lib/server-actions/submission-attempts";
```

- [ ] **Step 2: Replace the existing-row lookup + UPDATE/INSERT branch in `upsertMcqSubmissionAction`**

Replace `src/lib/server-actions/submissions.ts:823-974` (the block from `let existingSubmissionId: string | null = null;` through the end of the function) with:

```ts
  const attemptNumber = await getNextAttemptNumber(
    payload.activityId,
    payload.userId,
  );
  const timestamp = new Date().toISOString();

  try {
    const { rows } = await query(
      `
        insert into submissions (activity_id, user_id, attempt_number, body, submitted_at)
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [payload.activityId, payload.userId, attemptNumber, submissionBody, timestamp],
    );

    const parsed = SubmissionSchema.safeParse(rows?.[0]);
    if (!parsed.success) {
      console.error(
        "[submissions] Failed to parse inserted submission:",
        parsed.error,
      );
      return {
        success: false,
        error: "Invalid submission data.",
        data: null as Submission | null,
      };
    }

    await clearResubmitRequest(payload.activityId, payload.userId);

    await logActivitySubmissionEvent({
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      lessonId,
      pupilId: payload.userId,
      fileName: null,
      submittedAt: parsed.data.submitted_at ?? timestamp,
    });

    void emitSubmissionEvent("submission.updated", {
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      pupilId: payload.userId,
      submittedAt: parsed.data.submitted_at ?? timestamp,
      submissionStatus: "inprogress",
      isFlagged: false,
    });

    console.log("[realtime-debug] MCQ submission stored", {
      type: "insert",
      activityId: payload.activityId,
      pupilId: payload.userId,
      submissionId: parsed.data.submission_id,
      attemptNumber,
    });

    return { success: true, error: null, data: parsed.data };
  } catch (error) {
    console.error("[submissions] Failed to insert submission:", error);
    const message = error instanceof Error
      ? error.message
      : "Unable to insert submission.";
    return { success: false, error: message, data: null as Submission | null };
  }
}
```

- [ ] **Step 3: Apply the same replacement pattern to `upsertMatcherSubmissionAction`**

Replace `src/lib/server-actions/submissions.ts:1068-1209` (from `let existingSubmissionId: string | null = null;` through the end of the function) with the matcher equivalent:

```ts
  const attemptNumber = await getNextAttemptNumber(
    payload.activityId,
    payload.userId,
  );
  const timestamp = new Date().toISOString();

  try {
    const { rows } = await query(
      `
        insert into submissions (activity_id, user_id, attempt_number, body, submitted_at)
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [payload.activityId, payload.userId, attemptNumber, submissionBody, timestamp],
    );

    const parsed = SubmissionSchema.safeParse(rows?.[0]);
    if (!parsed.success) {
      console.error(
        "[submissions] Failed to parse inserted matcher submission:",
        parsed.error,
      );
      return {
        success: false,
        error: "Invalid submission data.",
        data: null as Submission | null,
      };
    }

    await clearResubmitRequest(payload.activityId, payload.userId);

    await logActivitySubmissionEvent({
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      lessonId,
      pupilId: payload.userId,
      fileName: null,
      submittedAt: parsed.data.submitted_at ?? timestamp,
    });

    void emitSubmissionEvent("submission.updated", {
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      pupilId: payload.userId,
      submittedAt: parsed.data.submitted_at ?? timestamp,
      submissionStatus: "inprogress",
      isFlagged: false,
    });

    return { success: true, error: null, data: parsed.data };
  } catch (error) {
    console.error("[submissions] Failed to insert matcher submission:", error);
    const message = error instanceof Error
      ? error.message
      : "Unable to insert submission.";
    return {
      success: false,
      error: message,
      data: null as Submission | null,
    };
  }
}
```

- [ ] **Step 4: Apply the same replacement pattern to `upsertGroupItemsSubmissionAction`**

Replace `src/lib/server-actions/submissions.ts:1311-1452` (from `let existingSubmissionId: string | null = null;` through the end of the function) with the group-items equivalent (identical shape to Step 3, swapping the log line text to `"group-items submission"` and using `groupItemsBody`'s already-built `submissionBody`).

- [ ] **Step 5: Delete now-unused code**

Confirm no remaining references to `existingSubmissionId` in this file:

Run: `grep -n "existingSubmissionId" src/lib/server-actions/submissions.ts`
Expected: no output.

- [ ] **Step 6: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 7: Manual verification — two attempts create two rows**

Run: `psql "$DATABASE_URL" -c "select count(*) from submissions where activity_id = '<test-mcq-activity-id>' and user_id = '<test-user-id>'"` before and after submitting the same MCQ activity twice through the running dev app (`pnpm dev`, answer the question, then change the answer and resubmit).
Expected: count increases by 1 each time, and `select attempt_number from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number` shows `1, 2`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server-actions/submissions.ts
git commit -m "feat: make MCQ/matcher/group-items submissions insert-only attempt history"
```

---

### Task 5: Convert `short-text.ts` write path to insert-only attempts

**Files:**
- Modify: `src/lib/server-actions/short-text.ts` (the submission-saving function containing the blocks at lines ~101-151, 236, 340, 379, 431, 498 — read the file first to identify the single pupil-submit write path vs. teacher-marking update paths)

**Interfaces:**
- Consumes: `getNextAttemptNumber`, `clearResubmitRequest` from `@/lib/server-actions/submission-attempts`.

- [ ] **Step 1: Read the file to distinguish the pupil-submit path from teacher-marking/override paths**

Run: `grep -n "^export async function" src/lib/server-actions/short-text.ts`

The pupil-facing submit action (the one matching the pattern at lines ~101-151: select existing → UPDATE-if-found else INSERT) is the one to convert. Teacher-marking/override actions (the `update submissions` blocks at lines ~340, 379, 498 that set `teacher_override_score`/`teacher_feedback`/`ai_model_score` on an *existing* row by `submission_id`) are intentionally left as `UPDATE ... WHERE submission_id = $id` — they amend a specific already-identified attempt row, they don't create new attempts, so they're untouched by this migration.

- [ ] **Step 2: Replace the pupil-submit existing-row lookup + UPDATE/INSERT branch**

In the pupil-submit function, replace the lookup-then-branch block (around lines 90-151) with:

```ts
  const attemptNumber = await getNextAttemptNumber(activityId, userId);

  const { rows } = await query(
    `
      insert into submissions (activity_id, user_id, attempt_number, body, submitted_at)
      values ($1, $2, $3, $4, $5)
      returning *
    `,
    [activityId, userId, attemptNumber, submissionBody, timestamp],
  );

  await clearResubmitRequest(activityId, userId);
```

(Adjust variable names — `activityId`, `userId`, `submissionBody`, `timestamp` — to whatever the surrounding function already names them; do not introduce new names that don't match the rest of the function.)

- [ ] **Step 3: Add the import**

```ts
import {
  clearResubmitRequest,
  getNextAttemptNumber,
} from "@/lib/server-actions/submission-attempts";
```

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Submit a short-text answer twice via the dev app for the same activity/pupil, then:

Run: `psql "$DATABASE_URL" -c "select attempt_number, body->>'answer' from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number"`
Expected: two rows, `attempt_number` 1 and 2, each with the answer text submitted at that time.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions/short-text.ts
git commit -m "feat: make short-text pupil submission insert-only attempt history"
```

---

### Task 6: Convert `long-text.ts` write path to insert-only attempts

**Files:**
- Modify: `src/lib/server-actions/long-text.ts:42-106`

**Interfaces:**
- Consumes: `getNextAttemptNumber`, `clearResubmitRequest` from `@/lib/server-actions/submission-attempts`.

- [ ] **Step 1: Add the import**

```ts
import {
  clearResubmitRequest,
  getNextAttemptNumber,
} from "@/lib/server-actions/submission-attempts";
```

- [ ] **Step 2: Replace the existing-row lookup + UPDATE/INSERT branch**

Replace the block spanning `src/lib/server-actions/long-text.ts:42-106` (select existing at line 42, `update submissions` at lines 69-70, `insert into submissions` at line 106) with a single unconditional insert, following the exact pattern from Task 4 Step 2 but using this file's existing variable names and its `insert into submissions (activity_id, user_id, body, submitted_at, submission_status)` column list — add `attempt_number` as a new column in that list, sourced from `getNextAttemptNumber(...)`, and call `clearResubmitRequest(...)` right after the insert succeeds, before the function's existing post-insert logic (telemetry/event emission) runs.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Submit a long-text/task activity twice via the dev app, then:

Run: `psql "$DATABASE_URL" -c "select attempt_number from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number"`
Expected: `1, 2`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/long-text.ts
git commit -m "feat: make long-text submission insert-only attempt history"
```

---

### Task 7: Convert `upload-url.ts` write path to insert-only attempts

**Files:**
- Modify: `src/lib/server-actions/upload-url.ts:51-108`

**Interfaces:**
- Consumes: `getNextAttemptNumber`, `clearResubmitRequest` from `@/lib/server-actions/submission-attempts`.

- [ ] **Step 1: Add the import and replace the existing-row lookup + UPDATE/INSERT branch**

Same pattern as Task 6 Step 2, applied to `src/lib/server-actions/upload-url.ts:51-108` (select existing at line 51, `update submissions` at lines 85-86, `insert into submissions` at line 108).

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Submit a URL-upload activity twice via the dev app, then:

Run: `psql "$DATABASE_URL" -c "select attempt_number from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number"`
Expected: `1, 2`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/upload-url.ts
git commit -m "feat: make upload-url submission insert-only attempt history"
```

---

### Task 8: Convert `lesson-activity-files.ts` write paths to insert-only attempts

**Files:**
- Modify: `src/lib/server-actions/lesson-activity-files.ts` (the submission-row-mutating blocks at lines 696-706, 844, 970-1009, 1105-1146, 1231-1251, 1297-1308 — read the file first to confirm which blocks create/replace a pupil submission record for an upload-worksheet/upload-spreadsheet activity vs. which only append to an already-existing row's `uploaded_files` JSON field)

This file mixes storage operations (uploading actual files) with submission-row bookkeeping. Two kinds of `update submissions` calls exist here:
1. **New-attempt creators**: blocks that select-existing-then-UPDATE-or-INSERT a full submission row when the pupil (re)submits the upload activity (lines ~696-706, ~1231-1308). These convert to insert-only, same as prior tasks.
2. **In-place file-list patches**: blocks like line 1009/1009 and 1146 that do `update submissions set body = jsonb_set(body::jsonb, '{uploaded_files}', $1::jsonb, true) where submission_id = $2` — these mutate the `uploaded_files` array on an *already-created* attempt row (e.g. pupil adds a second file to the same in-progress attempt before final submit). These stay as `UPDATE ... WHERE submission_id = $id` — they're not creating a new attempt, just adding a file to the current draft attempt, identified by a specific `submission_id` already in hand.

**Interfaces:**
- Consumes: `getNextAttemptNumber`, `clearResubmitRequest` from `@/lib/server-actions/submission-attempts`.

- [ ] **Step 1: Add the import**

```ts
import {
  clearResubmitRequest,
  getNextAttemptNumber,
} from "@/lib/server-actions/submission-attempts";
```

- [ ] **Step 2: Convert the block at lines 696-706 (select-existing at line 589, update at 696-697, insert at 706)**

Apply the same pattern as Task 6 Step 2: drop the UPDATE branch, always INSERT with a freshly-fetched `attempt_number`, call `clearResubmitRequest` after success.

- [ ] **Step 3: Convert the block at lines 1231-1308 (select-existing at line 1210/1286, update at 1231/1251/1297-1298, insert at 1308)**

Read the surrounding function bodies first (`sed -n '1190,1320p' src/lib/server-actions/lesson-activity-files.ts`) to confirm whether lines 1210-1251 and 1286-1308 are two separate functions or one function with two code paths (e.g. worksheet vs spreadsheet). Apply the insert-only pattern to each: drop the UPDATE-existing branch, always INSERT a new attempt row with `getNextAttemptNumber`, call `clearResubmitRequest` after success.

- [ ] **Step 4: Leave the `jsonb_set` patches (around lines 1009, 1146) as `UPDATE ... WHERE submission_id = $id` — no change**

These target a specific already-created row by primary key and don't create new attempts. Confirm by reading `sed -n '960,1020p'` and `sed -n '1090,1150p'` of the file that the `submission_id` used there comes from a `select ... order by attempt_number desc limit 1` (updated per Task 11) representing the pupil's *current, still-in-progress* attempt, not a historical one.

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Submit an upload-worksheet activity, then resubmit with a different file, via the dev app:

Run: `psql "$DATABASE_URL" -c "select attempt_number from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number"`
Expected: `1, 2`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server-actions/lesson-activity-files.ts
git commit -m "feat: make upload-worksheet/spreadsheet submission creation insert-only attempt history"
```

---

### Task 9: Convert `requestResubmissionAction` to unlock-next-attempt instead of zeroing in place

**Files:**
- Modify: `src/lib/server-actions/resubmit.ts:1-235`

**Interfaces:**
- Consumes: `setResubmitRequest` from `@/lib/server-actions/submission-attempts`.
- Produces: same `{ success, error }` shape as before.

- [ ] **Step 1: Add the import**

```ts
import { setResubmitRequest } from "@/lib/server-actions/submission-attempts";
```

- [ ] **Step 2: Replace the body-zeroing UPDATE with a resubmit-request upsert**

Replace `src/lib/server-actions/resubmit.ts:61-204` (everything from `try {` at line 61 through the end of the "Update submission" try/catch at line 204) with:

```ts
      try {
        const { rows: activityRows } = await query(
          "select activity_id from activities where activity_id = $1 limit 1",
          [parsed.data.activityId],
        );
        if (!activityRows?.[0]) {
          return RequestResubmissionReturnSchema.parse({
            success: false,
            error: "Activity not found.",
          });
        }

        let submissionId: string | null = parsed.data.submissionId ?? null;
        if (!submissionId) {
          const { rows } = await query<{ submission_id: string }>(
            `select submission_id from submissions
             where activity_id = $1 and user_id = $2
             order by attempt_number desc limit 1`,
            [parsed.data.activityId, parsed.data.pupilId],
          );
          submissionId = rows?.[0]?.submission_id ?? null;
        }

        if (!submissionId) {
          return RequestResubmissionReturnSchema.parse({
            success: false,
            error: "Submission not found for this pupil.",
          });
        }

        await setResubmitRequest({
          activityId: parsed.data.activityId,
          userId: parsed.data.pupilId,
          note: parsed.data.note?.trim() || null,
          requestedBy: teacherProfile.userId,
        });
```

- [ ] **Step 3: Remove now-unused imports**

`McqSubmissionBodySchema` and `ShortTextSubmissionBodySchema` (and the `type` variable computed from `activityRow.type`, plus `successCriteriaIds`/`normaliseSuccessCriteriaScores`/`fetchActivitySuccessCriteriaIds` if no longer referenced) are no longer needed since the body-zeroing logic is gone.

Run: `grep -n "McqSubmissionBodySchema\|ShortTextSubmissionBodySchema\|normaliseSuccessCriteriaScores\|fetchActivitySuccessCriteriaIds" src/lib/server-actions/resubmit.ts`
Expected: no matches (remove the corresponding `import` lines if any remain).

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: no errors, no unused-import warnings.

- [ ] **Step 5: Manual verification**

Trigger "request resubmission" for a pupil's MCQ submission via the teacher results UI, then:

Run: `psql "$DATABASE_URL" -c "select * from submission_resubmit_requests where activity_id = '<id>' and user_id = '<id>'"`
Expected: one row with `requested = true` and the note you entered.

Run: `psql "$DATABASE_URL" -c "select attempt_number, body->>'is_correct' from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number"`
Expected: the existing attempt row's score/body is **unchanged** (not zeroed).

Then have the pupil resubmit and confirm a new attempt row appears and the `submission_resubmit_requests` row is gone (consumed by `clearResubmitRequest` from Task 4/5/etc.).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions/resubmit.ts
git commit -m "feat: requestResubmissionAction unlocks a new attempt instead of zeroing the existing one"
```

---

### Task 10: Update `tasks.ts` resubmit-tasks query to read from the new table

**Files:**
- Modify: `src/lib/server-actions/tasks.ts:30-65, 165-175`

**Interfaces:**
- Consumes: `submission_resubmit_requests` table directly (read-only join).

- [ ] **Step 1: Read the current query**

Run: `sed -n '20,75p' src/lib/server-actions/tasks.ts`

- [ ] **Step 2: Replace the `s.resubmit_requested = true` filter with a join against `submission_resubmit_requests`**

Change the query (around line 64, `and s.resubmit_requested = true`) to join the new table instead:

```sql
join submission_resubmit_requests r
  on r.activity_id = s.activity_id and r.user_id = s.user_id and r.requested = true
```

and change the selected `s.resubmit_note` (line 55) to `r.note as resubmit_note`. Also change any `order by submitted_at desc` in this query (used to pick the relevant row per activity/user) to `order by s.attempt_number desc`.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `psql "$DATABASE_URL" -c "select * from submission_resubmit_requests"` to confirm at least one row exists (from Task 9's manual test), then load the page/view in the dev app that calls this `tasks.ts` query and confirm the resubmit-flagged task still appears with its note.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/tasks.ts
git commit -m "fix: read resubmit flag from submission_resubmit_requests in tasks query"
```

---

### Task 11: Switch all "latest submission" reads to order by `attempt_number`

**Files:**
- Modify: `src/lib/server-actions/submissions.ts:85-93` (`getLatestSubmissionForActivityAction`)
- Modify: `src/lib/server-actions/short-text.ts` (lines ~101, 236, 431 — read-existing queries)
- Modify: `src/lib/server-actions/long-text.ts:42`
- Modify: `src/lib/server-actions/upload-url.ts:51`
- Modify: `src/lib/server-actions/lesson-activity-files.ts:350, 589, 792, 967, 1102, 1210, 1286`
- Modify: `src/lib/server-actions/resubmit.ts` (already handled in Task 9 Step 2)
- Modify: `src/lib/scoring/activity-scores.ts:701-713` (`selectLatestSubmission`)
- Modify: `src/lib/server-actions/assignment-results.ts` (search for `order by submitted_at`)
- Modify: `src/lib/server-actions/pupil-units.ts` (search for `order by submitted_at`)

**Interfaces:**
- No signature changes — purely an ordering-column swap, behavior-preserving for "give me the latest attempt."

- [ ] **Step 1: Find every remaining `order by submitted_at desc` across server actions**

Run: `grep -rn "order by submitted_at desc" src/lib/server-actions src/lib/scoring`

- [ ] **Step 2: Replace each with `order by attempt_number desc`**

For every match from Step 1 that is selecting from `submissions` to find "the" (most recent) row for an activity+user pair, change `order by submitted_at desc` (and `order by submitted_at desc nulls last`, if present) to `order by attempt_number desc`. Do not change this ordering anywhere it's used for a different purpose (e.g. listing all submissions across many users sorted by recency for a feed — confirm by reading the surrounding `SELECT`'s `WHERE` clause; if it filters to a single `user_id`, it's a latest-attempt lookup and should change).

- [ ] **Step 3: Update `selectLatestSubmission` in `activity-scores.ts`**

This helper compares two submitted_at timestamps to decide which is "latest" when merging in-memory results — it doesn't query the DB directly, so it has no SQL to change, but confirm its only callers now receive submissions already ordered by `attempt_number` from the query layer, so its timestamp comparison remains a correct tie-breaker. Read its call sites:

Run: `grep -rn "selectLatestSubmission" src/lib src/components`

If any caller is comparing submissions across different `(activity_id, user_id)` pairs (i.e. genuinely different attempt sequences), leave `selectLatestSubmission` as-is — it's still correct for that case since `submitted_at` only goes backward if clocks are wrong. No code change needed in this file; this step is a verification, not an edit.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

For an activity/user with 2+ attempts (created during earlier tasks' manual tests), reload the pupil-facing activity page and the teacher results page, and confirm both show the most recent attempt's score/feedback/answer (not an older one).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions src/lib/scoring
git commit -m "fix: order latest-submission lookups by attempt_number instead of submitted_at"
```

---

### Task 12: Accuracy metric in `readLessonSubmissionSummariesAction`

**Files:**
- Modify: `src/types/index.ts` (find `LessonSubmissionSummary` schema/type definition — search `grep -n "LessonSubmissionSummary" src/types/index.ts`)
- Modify: `src/lib/server-actions/submissions.ts:230-741` (`readLessonSubmissionSummariesAction`)

**Interfaces:**
- Consumes: all `submissions` rows per activity (already fetched at line ~232-240 — currently `select submission_id, activity_id, user_id, submitted_at, body`; add `attempt_number` to that select list).
- Produces: `LessonSubmissionSummary.scores[].accuracy: number | null` alongside the existing `score`.

- [ ] **Step 1: Add `attempt_number` to the submissions select and to `accuracy` on each score entry's type**

Find the `LessonSubmissionSummary` Zod schema in `src/types/index.ts` (it has a `scores` array field per the usage in `submissions.ts`). Add `accuracy: z.number().nullable()` to the score-entry sub-schema, next to the existing `score: z.number().nullable()` field.

- [ ] **Step 2: Add `attempt_number` to the submissions query**

In `src/lib/server-actions/submissions.ts`, change the query at lines 232-238 from:

```sql
select submission_id, activity_id, user_id, submitted_at, body
from submissions
where activity_id = any($1::text[])
```

to:

```sql
select submission_id, activity_id, user_id, attempt_number, submitted_at, body
from submissions
where activity_id = any($1::text[])
```

- [ ] **Step 3: Compute accuracy per user per activity**

For each activity type's scoring block (MCQ at lines ~298-396, short-text at ~397-504, upload at ~505-609, general at ~610-711), after building `scoreEntries`/`numericScores` (which today represent **all** submission rows for that activity, since `submissionsByActivity` already groups every row — this is correct, it is NOT deduplicated to one-per-user today), group those entries by `userId` and compute, per user:

```ts
function computeAccuracyByUser(
  entries: Array<{ userId: string; score: number | null }>,
): Map<string, number | null> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const entry of entries) {
    if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
      continue;
    }
    const existing = totals.get(entry.userId) ?? { sum: 0, count: 0 };
    existing.sum += entry.score;
    existing.count += 1;
    totals.set(entry.userId, existing);
  }
  const accuracyByUser = new Map<string, number | null>();
  for (const [userId, { sum, count }] of totals) {
    accuracyByUser.set(userId, count > 0 ? sum / count : null);
  }
  return accuracyByUser;
}
```

Add this function near the top of `src/lib/server-actions/submissions.ts` (after the existing imports, before `SubmissionResultSchema`). Then, in each scoring block, after building `summary.scores`, compute `const accuracyByUser = computeAccuracyByUser(summary.scores);` and map it onto each entry: `summary.scores = summary.scores.map((entry) => ({ ...entry, accuracy: accuracyByUser.get(entry.userId) ?? null }));`.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Write a manual verification query**

For an MCQ activity/user with 2 attempts where attempt 1 scored 0 and attempt 2 scored 1:

Run: `psql "$DATABASE_URL" -c "select attempt_number, body->>'is_correct' from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number"`

Then load the lesson page that calls `readLessonSubmissionSummariesAction` (find it via `grep -rn "readLessonSubmissionSummariesAction" src/app`) and confirm in the returned data (e.g. via a temporary `console.log` or browser network tab) that `scores[].accuracy` for that user is `0.5` ((0+1)/2) while `score` (the latest/averaged value used today) is unaffected.

- [ ] **Step 6: Remove any temporary debug logging added in Step 5**

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/lib/server-actions/submissions.ts
git commit -m "feat: compute accuracy (sum of attempt scores / attempt count) in lesson submission summaries"
```

---

### Task 13: Accuracy metric in `assignment-results.ts`

**Files:**
- Modify: `src/lib/server-actions/assignment-results.ts` (find the cell-building logic via `grep -n "score:" src/lib/server-actions/assignment-results.ts`)

**Interfaces:**
- Consumes: `computeAccuracyByUser`-style logic (duplicate the small helper from Task 12 here, or export it from `submissions.ts` and import — prefer importing to avoid duplication).
- Produces: each results-matrix cell gains `accuracy: number | null` alongside `score`.

- [ ] **Step 1: Export the helper from Task 12**

In `src/lib/server-actions/submissions.ts`, change `function computeAccuracyByUser(` to `export function computeAccuracyByUser(`.

- [ ] **Step 2: Read the cell-building code to find where per-activity submission rows are fetched and scored**

Run: `grep -n "select.*from submissions\|interface.*Cell\|score:" src/lib/server-actions/assignment-results.ts | head -40`

- [ ] **Step 3: Add `accuracy` to the cell type and computation**

Find the TypeScript type/interface for a results cell (it has `submission_id`, `score`, per the dashboard component reading `cell.score`/`cell.submissionId` — grep confirmed `submission_id: string | null` at dashboard line 130). Add `accuracy: number | null` to that type. In the function that builds cells from raw submission rows for an activity, fetch **all** attempt rows per activity/user (not just the latest — if the current query already does `order by submitted_at desc` then takes the first per user, change it to fetch all rows for the activity, keep the existing "pick latest per user" logic for the cell's `score`/`submissionId`/etc., and additionally run `computeAccuracyByUser` over all rows to attach `accuracy` to each user's cell.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Load `/results/assignments/[assignmentId]` for an assignment containing the test activity/user from Task 12 Step 5, and confirm (via temporary logging or the React DevTools component tree) that the cell for that pupil/activity carries `accuracy: 0.5`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions/submissions.ts src/lib/server-actions/assignment-results.ts
git commit -m "feat: surface accuracy on assignment results cells"
```

---

### Task 14: `readSubmissionAttemptsAction` for teacher attempt history

**Files:**
- Create: `src/lib/server-actions/submission-attempts.ts` (extend the file from Task 3 — same file, new export)

**Interfaces:**
- Consumes: `query` from `@/lib/db`, `SubmissionSchema` from `@/types`.
- Produces: `readSubmissionAttemptsAction(activityId: string, userId: string): Promise<{ data: Submission[]; error: string | null }>`.

- [ ] **Step 1: Write the failing-state action (returns empty until query is wired)**

Add to `src/lib/server-actions/submission-attempts.ts`:

```ts
import { SubmissionSchema, type Submission } from "@/types";

export async function readSubmissionAttemptsAction(
  activityId: string,
  userId: string,
): Promise<{ data: Submission[]; error: string | null }> {
  try {
    const { rows } = await query(
      `
        select *
        from submissions
        where activity_id = $1 and user_id = $2
        order by attempt_number asc
      `,
      [activityId, userId],
    );

    const parsed = SubmissionSchema.array().safeParse(rows ?? []);
    if (!parsed.success) {
      console.error(
        "[submission-attempts] Failed to parse attempt rows:",
        parsed.error,
      );
      return { data: [], error: "Invalid submission data." };
    }

    return { data: parsed.data, error: null };
  } catch (error) {
    console.error(
      "[submission-attempts] Failed to read submission attempts:",
      error,
    );
    const message = error instanceof Error
      ? error.message
      : "Unable to load submission attempts.";
    return { data: [], error: message };
  }
}
```

- [ ] **Step 2: Export it through the consolidated re-export point**

Run: `grep -n "submission-attempts\|submissions\"" src/lib/server-updates.ts`

Add `readSubmissionAttemptsAction` to the re-export list in `src/lib/server-updates.ts`, following whatever pattern existing `submissions.ts` exports use there (e.g. `export { readSubmissionAttemptsAction } from "@/lib/server-actions/submission-attempts";`).

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `node -e "require('ts-node/register'); /* not directly runnable as plain node */"` — instead verify via a temporary call from an existing server component/route that already has DB access, or directly via psql mirroring the query:

Run: `psql "$DATABASE_URL" -c "select attempt_number, submitted_at from submissions where activity_id = '<id>' and user_id = '<id>' order by attempt_number asc"`
Expected: matches the rows the action would return, oldest first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server-actions/submission-attempts.ts src/lib/server-updates.ts
git commit -m "feat: add readSubmissionAttemptsAction for teacher attempt history view"
```

---

### Task 15: Teacher results UI — Attempts tab and accuracy display

**Files:**
- Modify: `src/components/assignment-results/assignment-results-dashboard.tsx` (the pupil/activity detail `Sheet`, tabs area around line 2559 `<TabsTrigger value="auto">Automatic score</TabsTrigger>`)

**Interfaces:**
- Consumes: `readSubmissionAttemptsAction` from `@/lib/server-updates`, `cell.accuracy` (from Task 13) on the existing cell type.

- [ ] **Step 1: Read the existing Sheet/Tabs structure**

Run: `sed -n '2280,2330p;2550,2620p' src/components/assignment-results/assignment-results-dashboard.tsx`

- [ ] **Step 2: Add an accuracy line next to the existing score display**

At line 2313 (`{formatPercent(selection.cell.score ?? null)}`), add the accuracy alongside it:

```tsx
<span className="text-sm text-muted-foreground">
  Accuracy: {formatPercent(selection.cell.accuracy ?? null)}
</span>
```

(placed in the same container that renders the score, matching existing JSX structure/classes around line 2313 rather than introducing new layout patterns).

- [ ] **Step 3: Add an "Attempts" `TabsTrigger` and matching `TabsContent`**

Next to the existing `<TabsTrigger value="auto">Automatic score</TabsTrigger>` (line 2559), add:

```tsx
<TabsTrigger value="attempts">Attempts</TabsTrigger>
```

Add a new client-side state + effect in the same component to fetch attempts when the sheet opens for a given `selection`:

```tsx
const [attempts, setAttempts] = useState<Submission[]>([])
const [attemptsLoading, setAttemptsLoading] = useState(false)

useEffect(() => {
  if (!selection) {
    setAttempts([])
    return
  }
  let cancelled = false
  setAttemptsLoading(true)
  readSubmissionAttemptsAction(selection.cell.activityId, selection.pupilId)
    .then(({ data }) => {
      if (!cancelled) setAttempts(data)
    })
    .finally(() => {
      if (!cancelled) setAttemptsLoading(false)
    })
  return () => {
    cancelled = true
  }
}, [selection])
```

(Match `selection`'s actual field names — `activityId`/`pupilId` or equivalent — to whatever this component already uses elsewhere in the file; grep for `selection.cell.` and `selection.pupilId` usages nearby to confirm exact field names before writing this.)

Add the corresponding `<TabsContent value="attempts">` rendering a simple ordered list:

```tsx
<TabsContent value="attempts" className="space-y-3">
  {attemptsLoading ? (
    <p className="text-sm text-muted-foreground">Loading attempts…</p>
  ) : attempts.length === 0 ? (
    <p className="text-sm text-muted-foreground">No attempts yet.</p>
  ) : (
    attempts.map((attempt) => (
      <div key={attempt.submission_id} className="rounded border p-3 text-sm">
        <div className="font-medium">Attempt {attempt.attempt_number}</div>
        <div className="text-muted-foreground">
          {new Date(attempt.submitted_at).toLocaleString()}
        </div>
      </div>
    ))
  )}
</TabsContent>
```

- [ ] **Step 4: Import `readSubmissionAttemptsAction` and the `Submission` type**

```tsx
import { readSubmissionAttemptsAction } from "@/lib/server-updates"
import type { Submission } from "@/types"
```

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Manual verification in the browser**

Run: `pnpm dev`, navigate to `/results/assignments/<assignmentId>` for an assignment containing a pupil/activity pair with 2+ attempts (from earlier manual tests), open that pupil/activity's detail sheet, click the "Attempts" tab.
Expected: both attempts listed, newest attempt matches the "current" score shown in the "Automatic score" tab, accuracy line shows a value consistent with `(sum of attempt scores)/count`.

- [ ] **Step 7: Commit**

```bash
git add src/components/assignment-results/assignment-results-dashboard.tsx
git commit -m "feat: add Attempts tab and accuracy display to teacher results sheet"
```

---

### Task 16: Run full lint and existing Playwright suite

**Files:** none (verification-only task)

- [ ] **Step 1: Run lint across the whole project**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 2: Run the Playwright suite**

Run: `pnpm test`
Expected: all existing specs pass — in particular, any spec touching submission/resubmit flows. If a spec asserts on exact row counts or `submitted_at`-based ordering that's now affected, investigate failures per `superpowers:systematic-debugging` rather than loosening assertions blindly.

- [ ] **Step 3: Fix any failures surfaced, re-run, and commit fixes**

```bash
git add -A
git commit -m "fix: address test failures from multi-attempt submission changes"
```

(Only run this commit if Step 2 actually required changes — skip if the suite passed cleanly.)

---

### Task 17 (deferred, separate follow-up — do not execute as part of this plan)

Once the above is verified in production for a period of time, a follow-up migration should drop `submissions.resubmit_requested` and `submissions.resubmit_note` (no longer written or read by any code path after Task 9). This is intentionally **not** included as an executable task here — per the spec's migration plan, it ships as its own later change once production behavior is confirmed stable.

---

## Self-Review Notes

- **Spec coverage:** schema change (Task 1), accuracy formula sum/count (Tasks 12-13), unlimited attempts (no cap added anywhere — confirmed), resubmit-unlocks-new-attempt (Task 9), all scorable types covered (Tasks 4-8), teacher attempt history UI (Tasks 14-15), migration ordering matches spec (additive schema first, then behavior switch, then UI, deferred column drop last).
- **Type consistency:** `getNextAttemptNumber`/`clearResubmitRequest`/`setResubmitRequest`/`getResubmitRequest` names are used identically across Tasks 3-10; `computeAccuracyByUser` defined once in Task 12 and imported (not redefined) in Task 13; `readSubmissionAttemptsAction` defined in Task 14 with the exact signature consumed in Task 15.
- **No placeholders:** every code-bearing step includes literal code; tasks 5-8 reference exact line ranges read from the actual files during exploration and instruct the implementer to confirm variable names in-place rather than guessing, since those files are large and weren't fully reproduced inline here — this is a deliberate "read first, then match existing names" instruction, not a TBD.
