# Common Mark Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every AI-marked submission attempt a single shared, real-time status (`waiting | reading | marking | marked | reading-error | marking-error`) stored once on `submissions.mark_status`, driven by the AI queue, and shown live in the results dashboard (Automatic Score panel + each attempt row).

**Architecture:** Replace the worksheet-only `body.ocr_status` and the `ai_marking_queue.status` column with one canonical `submissions.mark_status` column (+ `mark_error`). The queue claims work by `mark_status='waiting'` and writes `marking`/`marked`/`marking-error`. Every transition emits an SSE `submission.updated` event (now including `pupilId`) that the dashboard consumes to update its `attempts` state live.

**Tech Stack:** Next.js 15 App Router, PostgreSQL via `pg`, Zod, existing SSE hub, React 19.

## Global Constraints

- Two-space indentation. Server actions/routes return `{ data, error }`/route JSON; DB access in try/catch.
- Status vocabulary is EXACTLY: `waiting | reading | marking | marked | reading-error | marking-error`. Defined once in `src/dino.config.ts`; Zod enum in `src/types/index.ts`. No other status strings.
- `submissions.mark_status` is the single source of truth. The queue does NOT keep its own status column. `body.ocr_status`/`body.ocr_error` are removed entirely (deleted, not commented).
- Applies to AI-marked types only: `upload-worksheet`, `short-text-question`, `upload-spreadsheet`. `reading`/`reading-error` are worksheet-only.
- Every status write emits `emitSubmissionEvent("submission.updated", { submissionId, activityId, pupilId, markStatus, markError?, markedAt? })` — **`pupilId` is required** (the dashboard drops events without it).
- Dates display DD-MM-YYYY.
- No unit-test runner; `pnpm build` is the type-check gate (`pnpm lint` is broken repo-wide). Migrations live in `src/migrations/`; apply to the worktree DB manually.
- Work in an isolated worktree with its own cloned DB.

---

## Pre-Task Setup (worktree)

- [ ] **Step 1: Create worktree + cloned DB + dev server**

```bash
git worktree add .worktrees/mark-status -b feature/mark-status
./scripts/setup-worktree-db.sh mark-status --start-server
```
If the clone step reports the DB missing (known script quirk), clone manually:
```bash
export PGPASSWORD='your-super-secret-and-long-postgres-password'
psql -h localhost -p 5433 -U postgres -d comment_bank -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='dino' and pid<>pg_backend_pid();" >/dev/null
psql -h localhost -p 5433 -U postgres -d comment_bank -c 'CREATE DATABASE "postgres-mark-status" TEMPLATE dino;'
```
Confirm the dev server port from `tmux attach -t worktree-mark-status`. All work happens in `.worktrees/mark-status`.

---

## File Structure

- **Modify** `src/dino.config.ts` — `MARK_STATUSES` array, `MarkStatus` type, `isMarkStatus()`.
- **Create** `src/lib/mark-status.ts` — `markStatusLabel(status, markedAt?)` display helper (shared by dashboard + pupil component).
- **Modify** `src/types/index.ts` — `MarkStatusSchema`; `SubmissionSchema` gains `mark_status`, `mark_error`; remove `ocr_status`/`ocr_error` from `UploadWorksheetSubmissionBodySchema`; delete `WorksheetOcrStatusSchema`.
- **Create** `src/migrations/078-mark-status.sql` — columns, backfill, queue changes.
- **Modify** `src/lib/ai/marking-queue.ts` — enqueue/claim/retry/recover on `submissions.mark_status`; drop queue `status`.
- **Modify** writers: `src/app/api/pupil-submission/upload-worksheet/route.ts`, `src/app/webhooks/image-to-text/route.ts`, `src/app/webhooks/ai-mark/route.ts`, `src/lib/server-actions/submissions.ts` (editWorksheetTextAction), `src/lib/server-actions/short-text.ts` (submit + `triggerManualAiMarkingAction`), `src/app/api/pupil-submission/upload-spreadsheet/route.ts`.
- **Modify** UI: `src/components/pupil/pupil-upload-worksheet-activity.tsx`, `src/components/assignment-results/assignment-results-dashboard.tsx`.

---

## Task 1: Shared status vocabulary + label helper

**Files:** Modify `src/dino.config.ts`; Create `src/lib/mark-status.ts`; Modify `src/types/index.ts`.

**Interfaces — Produces:**
- `MARK_STATUSES` (frozen array), `MarkStatus` union, `isMarkStatus(v: unknown): v is MarkStatus` from `@/dino.config`.
- `MarkStatusSchema = z.enum(MARK_STATUSES)` from `@/types`.
- `markStatusLabel(status: MarkStatus | null, markedAt?: string | null): { label: string; tone: "pending"|"active"|"done"|"error" }` from `@/lib/mark-status`.

- [ ] **Step 1: Add the vocabulary to `src/dino.config.ts`**

```typescript
export const MARK_STATUSES = Object.freeze([
  "waiting",
  "reading",
  "marking",
  "marked",
  "reading-error",
  "marking-error",
] as const);

export type MarkStatus = (typeof MARK_STATUSES)[number];

const MARK_STATUS_SET: ReadonlySet<string> = new Set(MARK_STATUSES);

export function isMarkStatus(value: unknown): value is MarkStatus {
  return typeof value === "string" && MARK_STATUS_SET.has(value);
}
```

- [ ] **Step 2: Add the Zod enum + Submission fields in `src/types/index.ts`**

Add near the top (after imports):
```typescript
import { MARK_STATUSES } from "@/dino.config";
export const MarkStatusSchema = z.enum(MARK_STATUSES);
```
In `SubmissionSchema`, add (after `resubmit_note`):
```typescript
    mark_status: MarkStatusSchema.nullable().optional(),
    mark_error: z.string().nullable().optional(),
```

- [ ] **Step 3: Create the label helper `src/lib/mark-status.ts`**

```typescript
import type { MarkStatus } from "@/dino.config";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function markStatusLabel(
  status: MarkStatus | null | undefined,
  markedAt?: string | null,
): { label: string; tone: "pending" | "active" | "done" | "error" } {
  switch (status) {
    case "waiting":
      return { label: "Waiting…", tone: "pending" };
    case "reading":
      return { label: "Reading…", tone: "active" };
    case "marking":
      return { label: "Marking…", tone: "active" };
    case "marked":
      return {
        label: markedAt ? `Marked ${formatDate(markedAt)}` : "Marked",
        tone: "done",
      };
    case "reading-error":
      return { label: "Reading error", tone: "error" };
    case "marking-error":
      return { label: "Marking error", tone: "error" };
    default:
      return { label: "—", tone: "pending" };
  }
}
```

- [ ] **Step 4: Type-check** — `pnpm build`. Expected: builds (nothing consumes these yet; `SubmissionSchema` just gained optional fields).

- [ ] **Step 5: Commit**
```bash
git add src/dino.config.ts src/lib/mark-status.ts src/types/index.ts
git commit -m "feat: shared mark-status vocabulary + label helper"
```

---

## Task 2: Migration — columns, backfill, queue change

**Files:** Create `src/migrations/078-mark-status.sql`.

**Interfaces — Produces:** `submissions.mark_status text`, `submissions.mark_error text` (indexed); `ai_marking_queue` without `status`, with a plain unique index on `submission_id`.

- [ ] **Step 1: Write the migration**

Create `src/migrations/078-mark-status.sql`:
```sql
-- Common mark status: single source of truth on submissions; queue drops status.
BEGIN;

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS mark_status text;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS mark_error text;
CREATE INDEX IF NOT EXISTS submissions_mark_status_idx ON public.submissions (mark_status);

-- Backfill from the old worksheet body.ocr_status and from applied marks.
UPDATE public.submissions
SET mark_status = CASE
  WHEN (body::jsonb ->> 'ocr_status') = 'extracting' THEN 'reading'
  WHEN (body::jsonb ->> 'ocr_status') = 'extracted'  THEN 'waiting'
  WHEN (body::jsonb ->> 'ocr_status') = 'marking'    THEN 'marking'
  WHEN (body::jsonb ->> 'ocr_status') = 'marked'     THEN 'marked'
  WHEN (body::jsonb ->> 'ocr_status') = 'error'      THEN 'reading-error'
  WHEN (body::jsonb ? 'ai_marks')                    THEN 'marked'
  ELSE mark_status
END
WHERE mark_status IS NULL;

UPDATE public.submissions
SET mark_error = (body::jsonb ->> 'ocr_error')
WHERE mark_error IS NULL AND (body::jsonb ->> 'ocr_error') IS NOT NULL;

-- Queue: drop the status column and its dedup index; add a plain unique on submission_id.
ALTER TABLE public.ai_marking_queue DROP CONSTRAINT IF EXISTS ai_marking_queue_status_check;
DROP INDEX IF EXISTS ai_marking_queue_submission_active_uq;
ALTER TABLE public.ai_marking_queue DROP COLUMN IF EXISTS status;
CREATE UNIQUE INDEX IF NOT EXISTS ai_marking_queue_submission_uq ON public.ai_marking_queue (submission_id);

COMMIT;
```
Note: the current partial-unique index name may differ. Before writing, run
`psql -h localhost -p 5433 -U postgres -d postgres-mark-status -c "\d ai_marking_queue"`
and use the actual index name in the `DROP INDEX` line (there is a partial unique on `submission_id WHERE status IN ('pending','processing')`). If none exists, the `DROP INDEX IF EXISTS` is a no-op.

- [ ] **Step 2: Apply to the worktree DB**
```bash
export PGPASSWORD='your-super-secret-and-long-postgres-password'
psql -h localhost -p 5433 -U postgres -d postgres-mark-status -f src/migrations/078-mark-status.sql
```
Expected: `COMMIT`. Then verify:
```bash
psql -h localhost -p 5433 -U postgres -d postgres-mark-status -c "\d submissions" | grep mark_
psql -h localhost -p 5433 -U postgres -d postgres-mark-status -c "\d ai_marking_queue" | grep -i status || echo "no status column (good)"
```

- [ ] **Step 3: Commit**
```bash
git add src/migrations/078-mark-status.sql
git commit -m "feat: migration — submissions.mark_status + drop ai_marking_queue.status"
```

---

## Task 3: Rewrite the marking queue on mark_status

**Files:** Modify `src/lib/ai/marking-queue.ts`.

**Interfaces — Consumes:** `MarkStatus` from `@/dino.config`. **Produces:** unchanged exports (`enqueueMarkingTasks`, `processNextQueueItem`, `triggerQueueProcessor`, `recoverStuckItems`, and any callback resolver) but operating on `submissions.mark_status`.

Current behaviour to replace (all in this file): enqueue inserts `status='pending'`; `processNextQueueItem` claims `WHERE status='pending' … SET status='processing'`; failure sets `status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending'`; `resolveQueueItem` sets `status='completed'`; `recoverStuckItems` resets stuck `processing`; `pruneCompletedQueueItems` deletes `completed`.

- [ ] **Step 1: Rewrite `enqueueMarkingTasks`**

Set the submission to `waiting` and upsert a status-less queue row. For each task:
```typescript
await query(
  `update submissions set mark_status='waiting', mark_error=null where submission_id=$1`,
  [submissionId],
);
await query(
  `
    insert into ai_marking_queue (submission_id, assignment_id, attempts, process_after)
    values ($1, $2, 0, now() + make_interval(secs => $3))
    on conflict (submission_id) do update set
      assignment_id = excluded.assignment_id,
      attempts = 0,
      process_after = now() + make_interval(secs => $3),
      updated_at = now()
  `,
  [submissionId, assignmentId, processAfterSeconds ?? 0],
);
```
(Keep the existing `processAfterSeconds` option; default 0.)

- [ ] **Step 2: Rewrite the claim in `processNextQueueItem`**

Claim by the submission's status, lock the queue rows:
```typescript
const { rows: claimed } = await query<{ submission_id: string; assignment_id: string; attempts: number }>(
  `
    update submissions s
    set mark_status = 'marking'
    from (
      select q.submission_id, q.assignment_id, q.attempts
      from ai_marking_queue q
      join submissions sub on sub.submission_id = q.submission_id
      where sub.mark_status = 'waiting' and q.process_after <= now() and q.attempts < 3
      order by q.process_after asc
      limit $1
      for update of q skip locked
    ) picked
    where s.submission_id = picked.submission_id
    returning s.submission_id, picked.assignment_id as assignment_id, picked.attempts as attempts
  `,
  [BATCH_SIZE],
);
```
Emit `marking` SSE per claimed submission (Task 6 provides the emit; for now update `mark_status` only — the SSE wiring is Task 6, but include the emit call here referencing `emitSubmissionEvent` and gather `activity_id`/`user_id` via the existing context query already present in `processSingleItem`). Then process each via the existing `processSingleItem` path.

- [ ] **Step 3: Rewrite failure/retry in `processSingleItem`**

Replace the failure UPDATE (currently sets queue `status`) with: increment `attempts`; if `attempts >= 3` set submission `mark_status='marking-error'`, `mark_error=<reason>` and delete the queue row; else set submission `mark_status='waiting'` and bump `process_after`:
```typescript
await query(`update ai_marking_queue set attempts = attempts + 1, last_error = $1, updated_at = now(), process_after = now() + interval '30 seconds' where submission_id = $2`, [reason, submissionId]);
const { rows: a } = await query<{ attempts: number }>(`select attempts from ai_marking_queue where submission_id=$1`, [submissionId]);
if ((a[0]?.attempts ?? 3) >= 3) {
  await query(`update submissions set mark_status='marking-error', mark_error=$1 where submission_id=$2`, [reason, submissionId]);
  await query(`delete from ai_marking_queue where submission_id=$1`, [submissionId]);
} else {
  await query(`update submissions set mark_status='waiting' where submission_id=$1`, [submissionId]);
}
```
For the unsupported-activity-type branch (currently sets `completed`): set the submission `mark_status='marking-error'`, `mark_error='Unsupported activity type'`, delete the queue row.

- [ ] **Step 4: Replace `resolveQueueItem`** (called by the `ai-mark` webhook on success)

```typescript
export async function resolveQueueItem(submissionId: string) {
  await query(`delete from ai_marking_queue where submission_id=$1`, [submissionId]);
}
```
(The submission `mark_status='marked'` is set by the webhook in Task 5. This just clears the work-list row.)

- [ ] **Step 5: Rewrite `recoverStuckItems`**

```typescript
export async function recoverStuckItems() {
  await query(
    `update submissions set mark_status='waiting'
     where mark_status='marking'
       and submission_id in (select submission_id from ai_marking_queue where updated_at < now() - interval '10 minutes')`,
  );
}
```
Remove `pruneCompletedQueueItems` (no `completed` state now) or repoint it to delete orphan queue rows whose submission is `marked`/`marking-error`:
```typescript
export async function pruneCompletedQueueItems() {
  await query(`delete from ai_marking_queue q using submissions s where s.submission_id=q.submission_id and s.mark_status in ('marked','marking-error')`);
}
```

- [ ] **Step 6: Type-check** — `pnpm build`. Fix references to the removed `status` column.

- [ ] **Step 7: Commit**
```bash
git add src/lib/ai/marking-queue.ts
git commit -m "feat: marking queue claims/updates submissions.mark_status (no queue status)"
```

---

## Task 4: Status writers — worksheet + short-text + spreadsheet + edit + manual

**Files:** Modify `src/app/api/pupil-submission/upload-worksheet/route.ts`, `src/app/webhooks/image-to-text/route.ts`, `src/lib/server-actions/submissions.ts`, `src/lib/server-actions/short-text.ts`, `src/app/api/pupil-submission/upload-spreadsheet/route.ts`. Remove `ocr_status`/`ocr_error` from `UploadWorksheetSubmissionBodySchema` and delete `WorksheetOcrStatusSchema` in `src/types/index.ts`.

**Interfaces — Consumes:** `submissions.mark_status` column. All these set the COLUMN (via `update submissions set mark_status=…`), not `body`.

- [ ] **Step 1: Remove ocr_status/ocr_error from the schema**

In `src/types/index.ts`: delete `WorksheetOcrStatusSchema` and its type; remove the `ocr_status` and `ocr_error` lines from `UploadWorksheetSubmissionBodySchema` (keep `.passthrough()`).

- [ ] **Step 2: Worksheet upload route**

The submission is created via `insert into submissions (...)`. Add `mark_status` to that insert as a column value `'reading'` (the row has the column now). Where it previously wrote `ocr_status: "extracting"` in the body object, remove that; instead include the column in the INSERT column list: `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status, mark_status) values (…, 'reading')`. On the OCR read/invoke failure catch (previously set body `ocr_status:"error"`): `update submissions set mark_status='reading-error', mark_error='Could not read images. Please try re-uploading.' where submission_id=$1`. Remove the body `ocr_status`/`ocr_error` writes.

- [ ] **Step 3: image-to-text callback**

Currently sets body `ocr_status:"marking"`. Change to: keep writing `extractedText` to body, but set status via column — after storing text, `update submissions set mark_status='waiting', mark_error=null where submission_id=$1`, then `enqueueMarkingTasks(...)` (which also sets waiting; harmless). On the not-worksheet/invalid-body path, set `mark_status='reading-error'`. Update the SSE emit to `markStatus:"waiting"` and include `pupilId` (fetch `user_id` from the submission row already queried).

- [ ] **Step 4: editWorksheetTextAction (`submissions.ts`)**

Currently new attempt body has `ocr_status:"marking"`. Remove from body; set the new submission's column: include `mark_status` in the INSERT as `'waiting'` (edited text goes straight to marking) — actually set `'waiting'` and let enqueue handle it; then `enqueueMarkingTasks`. Update the SSE emit to `markStatus:"waiting"`, include `pupilId` (= input.userId).

- [ ] **Step 5: short-text submit + triggerManualAiMarkingAction (`short-text.ts`)**

On submit (the debounced enqueue block): before/around `enqueueMarkingTasks`, the enqueue already sets `mark_status='waiting'` (Task 3). Ensure an SSE emit fires with `markStatus:"waiting"`, `pupilId`. In `triggerManualAiMarkingAction`: it already calls `enqueueMarkingTasks` (which sets `waiting`); add an SSE emit `markStatus:"waiting"` with the pupilId from the input. (Input has `pupilId`.)

- [ ] **Step 6: spreadsheet upload route**

The enqueue block sets `waiting` via `enqueueMarkingTasks`. Add an SSE emit `markStatus:"waiting"`, `pupilId` (= the pupil `userId`).

- [ ] **Step 7: Type-check** — `pnpm build`. Fix any remaining `ocr_status`/`ocr_error` references (the pupil component in Task 7 still references them — build will flag; note them, they're Task 7).

- [ ] **Step 8: Commit**
```bash
git add -A
git commit -m "feat: status writers set submissions.mark_status (reading/waiting) + emit pupilId"
```

---

## Task 5: ai-mark callback → marked (all AI-marked types) + SSE

**Files:** Modify `src/app/webhooks/ai-mark/route.ts`.

- [ ] **Step 1: Set mark_status='marked' for all AI-marked types**

In `applyAiMarkToSubmission`, replace the worksheet-only `ocr_status:"marked"` body write with a column update after the body UPDATE: `update submissions set mark_status='marked', mark_error=null where submission_id=$1` (for ALL activity types this function handles — short-text, spreadsheet, worksheet). Call `resolveQueueItem(submission_id)` (Task 3) to delete the queue row.

- [ ] **Step 2: Emit SSE with pupilId + markedAt**

Replace the worksheet-only `emitSubmissionEvent(..., { ocrStatus:"marked" })` with, for ALL these types:
```typescript
void emitSubmissionEvent("submission.updated", {
  submissionId: submission.submission_id,
  activityId,
  pupilId,
  markStatus: "marked",
  markedAt: new Date().toISOString(),
});
```
(`pupilId` is a parameter of `applyAiMarkToSubmission`.)

- [ ] **Step 3: Type-check + curl** — `pnpm build`. Then confirm the callback still returns 200 for a valid payload (auth header `mark-service-key`), 401 without.

- [ ] **Step 4: Commit**
```bash
git add src/app/webhooks/ai-mark/route.ts
git commit -m "feat: ai-mark callback sets mark_status=marked + emits pupilId/markedAt"
```

---

## Task 6: SSE emit on queue claim (marking) + payload shape audit

**Files:** Modify `src/lib/ai/marking-queue.ts` (emit on claim), `src/lib/sse/topics.ts` if a typed payload exists.

- [ ] **Step 1: Emit `marking` when the queue claims an item**

In `processNextQueueItem` after claiming, for each claimed submission fetch `activity_id`, `user_id` (the `processSingleItem` context query already selects `pupil_id` and `activity_id`; reuse it) and emit:
```typescript
void emitSubmissionEvent("submission.updated", {
  submissionId, activityId, pupilId, markStatus: "marking",
});
```
Import `emitSubmissionEvent` from `@/lib/sse/topics`.

- [ ] **Step 2: Emit `marking-error` on final failure** (in the failure branch from Task 3):
```typescript
void emitSubmissionEvent("submission.updated", { submissionId, activityId, pupilId, markStatus: "marking-error", markError: reason });
```

- [ ] **Step 3: Type-check** — `pnpm build`.

- [ ] **Step 4: Commit**
```bash
git add src/lib/ai/marking-queue.ts src/lib/sse/topics.ts
git commit -m "feat: emit marking/marking-error SSE from the queue"
```

---

## Task 7: Pupil worksheet component reads mark_status

**Files:** Modify `src/components/pupil/pupil-upload-worksheet-activity.tsx`.

- [ ] **Step 1: Swap ocr_status → mark_status**

Replace the local `ocrStatus` state type with `MarkStatus | null` (import from `@/dino.config`). Read the latest submission's `mark_status` (top-level column; if the component receives the submission row, use `submission.mark_status`; if it currently reads `body.ocr_status`, switch to the row's `mark_status` provided by `getLatestSubmissionForActivityAction`). Map render states: `reading` → "Reading your work…"; `waiting`/`marking` → "Marking…"; `marked` → done; `reading-error`/`marking-error` → show `mark_error`. On SSE `submission.updated`, read `payload.markStatus` (was `payload.ocrStatus`).

- [ ] **Step 2: Type-check + browser check** — `pnpm build`; upload a worksheet image as a pupil and confirm "Reading…" shows, then progresses.

- [ ] **Step 3: Commit**
```bash
git add src/components/pupil/pupil-upload-worksheet-activity.tsx
git commit -m "feat: pupil worksheet component reads mark_status"
```

---

## Task 8: Dashboard — status chip in Automatic Score panel + each attempt, live

**Files:** Modify `src/components/assignment-results/assignment-results-dashboard.tsx`.

**Interfaces — Consumes:** `markStatusLabel` from `@/lib/mark-status`; `attempts: Submission[]` now carry `mark_status`/`mark_error`; SSE `submission.updated` payload `{ submissionId, activityId, pupilId, markStatus, markError?, markedAt? }`.

- [ ] **Step 1: Add a `MarkStatusChip` inline helper**

Near the top of the component file:
```tsx
function MarkStatusChip({ status, markError, markedAt }: { status: MarkStatus | null | undefined; markError?: string | null; markedAt?: string | null }) {
  if (!status) return null
  const { label, tone } = markStatusLabel(status, markedAt)
  const cls = tone === "error" ? "bg-destructive/10 text-destructive"
    : tone === "done" ? "bg-emerald-500/10 text-emerald-600"
    : tone === "active" ? "bg-primary/10 text-primary"
    : "bg-muted text-muted-foreground"
  return <span title={markError ?? undefined} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
}
```
Import `MarkStatus` from `@/dino.config` and `markStatusLabel` from `@/lib/mark-status`.

- [ ] **Step 2: Render the chip in BOTH attempt rows**

In each `attempts.map((attempt) => …)` block (the two `TabsContent value="attempts"`), add beside the date:
```tsx
<MarkStatusChip status={attempt.mark_status ?? null} markError={attempt.mark_error} markedAt={attempt.mark_status === "marked" ? attempt.submitted_at : null} />
```

- [ ] **Step 3: Render the chip in the Automatic Score panel**

Derive the current status from the latest attempt for the selection:
```tsx
const latestAttempt = attempts.length ? attempts[attempts.length - 1] : null
```
In the panel header row (next to "Automatic score"), render `<MarkStatusChip status={latestAttempt?.mark_status ?? null} markError={latestAttempt?.mark_error} markedAt={latestAttempt?.submitted_at} />`.

- [ ] **Step 4: Update `attempts` live from SSE**

In the existing `source.onmessage` handler, for `topic==="submissions"` with a `markStatus`, update the `attempts` state:
```tsx
if (typeof payload.markStatus === "string") {
  setAttempts((prev) => prev.map((a) => a.submission_id === submissionId ? { ...a, mark_status: payload.markStatus as MarkStatus, mark_error: (payload.markError as string) ?? a.mark_error } : a))
  // if the submission isn't in the current list but matches the selection, reload
  if (selectionRef.current && payload.activityId === selectionRef.current.cell.activityId && payload.pupilId === selectionRef.current.cell.pupilId && !attemptsRef.current.some((a) => a.submission_id === submissionId)) {
    void reloadAttempts()
  }
}
```
Add `selectionRef`/`attemptsRef` refs (mirror the existing selection) and a `reloadAttempts()` that re-runs `readSubmissionAttemptsAction` for the current selection, so a brand-new attempt appears without losing the SSE connection. Do NOT add `attempts` to the SSE effect deps (use refs) to avoid reconnect churn.

- [ ] **Step 5: Type-check + browser verify** — `pnpm build`; open a worksheet activity's results, upload, and watch the panel + attempt chip go Reading → Waiting → Marking → Marked live.

- [ ] **Step 6: Commit**
```bash
git add src/components/assignment-results/assignment-results-dashboard.tsx
git commit -m "feat: dashboard shows live mark-status chip in score panel + each attempt"
```

---

## Task 9: End-to-end status verification (curl-driven)

**Files:** none (verification task).

- [ ] **Step 1: Drive the full transition set with SQL + curl and assert `mark_status`**

Insert a worksheet submission (or upload one), then:
- Assert `mark_status='reading'` after upload.
- `POST /webhooks/image-to-text` with the service key → assert `mark_status` becomes `waiting` then `marking` (after the queue runs).
- `POST /webhooks/ai-mark` with the service key + `marks_awarded` → assert `mark_status='marked'` and the queue row is gone.
- Force a `marking-error` by posting an invoke failure path (stop the marking webhook URL) → assert `marking-error` + `mark_error` set.
Record the observed statuses in the report.

- [ ] **Step 2: Confirm queue has no status column and no orphan rows**
```bash
psql -h localhost -p 5433 -U postgres -d postgres-mark-status -c "\d ai_marking_queue" | grep -i status || echo "no status column (good)"
psql -h localhost -p 5433 -U postgres -d postgres-mark-status -c "select count(*) from ai_marking_queue;"
```

- [ ] **Step 3: Commit** (if any doc/notes) — otherwise note completion in the ledger.

---

## Final Verification (before merge)
- [ ] `pnpm build` clean.
- [ ] No `ocr_status`/`ocr_error` references remain: `grep -rn "ocr_status\|ocr_error" src/` returns nothing.
- [ ] `git status` clean (no untracked feature files).
- [ ] Migration `078-mark-status.sql` committed; applied to the worktree DB.
- [ ] Merge via the `merge-tree` skill — its migration step will apply `078-mark-status.sql` to the main `dino` DB.
