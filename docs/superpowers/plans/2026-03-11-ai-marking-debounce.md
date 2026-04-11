# AI Marking Debounce Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 30-second debounce to auto AI marking so that rapid successive saves by a pupil only trigger one marking job, using the latest answer.

**Architecture:** Add a `process_after` timestamp column to `ai_marking_queue`. On auto-enqueue from a pupil save, insert with `process_after = now() + 30s`. If a pending entry already exists for that submission, reset its `process_after` to 30s from now instead of inserting a new row. The queue processor only claims rows where `process_after <= now()`. Manual enqueues (teacher-triggered bulk marking) bypass the delay.

**Tech Stack:** PostgreSQL, Next.js server actions (`src/lib/ai/marking-queue.ts`, `src/lib/server-actions/short-text.ts`)

---

## Context: How the queue works today

- `ai_marking_queue` has a partial unique index: `UNIQUE (submission_id) WHERE status IN ('pending', 'processing')`
- `enqueueMarkingTasks(assignmentId, tasks)` bulk-inserts with `ON CONFLICT ... DO NOTHING`
- `processNextQueueItem()` claims rows `WHERE status = 'pending' AND attempts < 3`
- `saveShortTextAnswerAction` upserts (updates existing or inserts new) submission in place — so `submission_id` stays stable across edits
- Auto-enqueue on save (added in commit `061a760`) is fire-and-forget, no delay

---

## File Map

| File | Change |
|---|---|
| `src/migrations/066-ai-queue-process-after.sql` | CREATE — add `process_after` column with default `now()` |
| `src/lib/ai/marking-queue.ts` | MODIFY — `enqueueMarkingTasks` accepts optional delay; `processNextQueueItem` filters on `process_after` |
| `src/lib/server-actions/short-text.ts` | MODIFY — pass `processAfterSeconds: 30` for auto-enqueue |

---

## Chunk 1: Database migration

### Task 1: Add `process_after` column to `ai_marking_queue`

**Files:**
- Create: `src/migrations/066-ai-queue-process-after.sql`

- [ ] **Step 1: Write the migration**

```sql
-- src/migrations/066-ai-queue-process-after.sql
ALTER TABLE ai_marking_queue
  ADD COLUMN IF NOT EXISTS process_after timestamptz NOT NULL DEFAULT now();

-- Back-fill existing rows so they are immediately eligible
UPDATE ai_marking_queue SET process_after = now() WHERE process_after > now();
```

- [ ] **Step 2: Apply the migration**

```bash
PGPASSWORD=your-super-secret-and-long-postgres-password \
  psql -h 127.0.0.1 -U postgres -d dino -f src/migrations/066-ai-queue-process-after.sql
```

Expected output:
```
ALTER TABLE
UPDATE 0   (or a count of existing rows)
```

- [ ] **Step 3: Verify column exists**

```bash
PGPASSWORD=your-super-secret-and-long-postgres-password \
  psql -h 127.0.0.1 -U postgres -d dino \
  -c "\d ai_marking_queue"
```

Expected: `process_after` column visible with type `timestamp with time zone`.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/066-ai-queue-process-after.sql
git commit -m "feat: add process_after column to ai_marking_queue"
```

---

## Chunk 2: Queue logic

### Task 2: Update `enqueueMarkingTasks` to support a delay

**Files:**
- Modify: `src/lib/ai/marking-queue.ts`

The function signature changes from:
```ts
enqueueMarkingTasks(assignmentId: string, tasks: Array<{ submissionId: string }>)
```
to:
```ts
enqueueMarkingTasks(
  assignmentId: string,
  tasks: Array<{ submissionId: string }>,
  options?: { processAfterSeconds?: number }
)
```

When `processAfterSeconds` is provided (auto-enqueue path):
- INSERT with `process_after = now() + make_interval(secs => N)`
- ON CONFLICT for a **pending** row: UPDATE `process_after` to reset the debounce window
- ON CONFLICT for a **processing** row: leave untouched (already in flight)

When `processAfterSeconds` is omitted (manual/bulk enqueue path):
- Behaves exactly as today: `process_after = now()` (immediate), `ON CONFLICT DO NOTHING`

- [ ] **Step 1: Replace `enqueueMarkingTasks` in `src/lib/ai/marking-queue.ts`**

Replace the existing function (lines 19-47) with:

```ts
export async function enqueueMarkingTasks(
  assignmentId: string,
  tasks: Array<{ submissionId: string }>,
  options?: { processAfterSeconds?: number },
) {
  if (tasks.length === 0) return;

  const delaySecs = options?.processAfterSeconds ?? 0;

  await logQueueEvent(
    "info",
    `Enqueueing ${tasks.length} tasks for assignment ${assignmentId}` +
      (delaySecs > 0 ? ` (debounced ${delaySecs}s)` : ""),
  );

  for (const task of tasks) {
    if (delaySecs > 0) {
      // Debounced path: upsert — reset process_after on conflict with pending row
      await query(
        `
        INSERT INTO ai_marking_queue (submission_id, assignment_id, status, process_after)
        VALUES ($1, $2, 'pending', now() + make_interval(secs => $3))
        ON CONFLICT (submission_id) WHERE status IN ('pending', 'processing')
        DO UPDATE SET
          process_after = CASE
            WHEN ai_marking_queue.status = 'pending'
              THEN now() + make_interval(secs => $3)
            ELSE ai_marking_queue.process_after
          END
        `,
        [task.submissionId, assignmentId, delaySecs],
      );
    } else {
      // Immediate path (manual/bulk): original behaviour
      await query(
        `
        INSERT INTO ai_marking_queue (submission_id, assignment_id, status, process_after)
        VALUES ($1, $2, 'pending', now())
        ON CONFLICT (submission_id) WHERE status IN ('pending', 'processing') DO NOTHING
        `,
        [task.submissionId, assignmentId],
      );
    }
  }
}
```

> Note: The debounced path uses a per-row loop rather than a bulk insert because PostgreSQL `ON CONFLICT DO UPDATE` with a `CASE` expression referencing `$3` in a bulk VALUES clause requires repeated params. The loop is fine here — auto-enqueue only ever passes one task at a time.

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
pnpm build 2>&1 | grep -E "error TS|Type error|✓ Compiled"
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/marking-queue.ts
git commit -m "feat: support debounce delay in enqueueMarkingTasks"
```

---

### Task 3: Update `processNextQueueItem` to respect `process_after`

**Files:**
- Modify: `src/lib/ai/marking-queue.ts` — the `WHERE` clause inside `processNextQueueItem`

Currently:
```sql
WHERE status = 'pending'
  AND attempts < 3
ORDER BY created_at ASC
```

Change to:
```sql
WHERE status = 'pending'
  AND attempts < 3
  AND process_after <= now()
ORDER BY process_after ASC
```

Ordering by `process_after` instead of `created_at` ensures debounced items are processed in the order they became eligible, not in insertion order.

- [ ] **Step 1: Edit `processNextQueueItem` in `src/lib/ai/marking-queue.ts`**

Find the claim query (around line 56) and change the WHERE/ORDER:

```ts
  const { rows } = await query(
    `
    UPDATE ai_marking_queue
    SET status = 'processing',
        attempts = attempts + 1,
        updated_at = now()
    WHERE queue_id IN (
      SELECT queue_id
      FROM ai_marking_queue
      WHERE status = 'pending'
        AND attempts < 3
        AND process_after <= now()
      ORDER BY process_after ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING queue_id, submission_id, assignment_id, attempts
    `,
    [BATCH_SIZE],
  );
```

Also update the remaining-count query to match:

```ts
  const { rows: countRows } = await query(
    "SELECT count(*) FROM ai_marking_queue WHERE status = 'pending' AND attempts < 3 AND process_after <= now()",
  );
```

- [ ] **Step 2: Build**

```bash
pnpm build 2>&1 | grep -E "error TS|Type error|✓ Compiled"
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/marking-queue.ts
git commit -m "feat: queue processor respects process_after debounce timestamp"
```

---

## Chunk 3: Wire up the delay on save

### Task 4: Pass `processAfterSeconds: 30` in `saveShortTextAnswerAction`

**Files:**
- Modify: `src/lib/server-actions/short-text.ts`

Currently (added in `061a760`):
```ts
void enqueueMarkingTasks(payload.assignmentId, [{ submissionId: savedSubmission.submission_id }])
  .then(() => triggerQueueProcessor())
  .catch(...)
```

Change to pass the delay option:

```ts
void enqueueMarkingTasks(
  payload.assignmentId,
  [{ submissionId: savedSubmission.submission_id }],
  { processAfterSeconds: 30 },
)
  .then(() => triggerQueueProcessor())
  .catch((err) => console.error("[short-text] Failed to enqueue AI marking:", err))
```

- [ ] **Step 1: Make the edit in `src/lib/server-actions/short-text.ts`**

Find the auto-enqueue block (inside the `if (payload.assignmentId)` guard) and add `{ processAfterSeconds: 30 }` as the third argument to `enqueueMarkingTasks`.

- [ ] **Step 2: Build**

```bash
pnpm build 2>&1 | grep -E "error TS|Type error|✓ Compiled"
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add src/lib/server-actions/short-text.ts
git commit -m "feat: debounce auto AI marking by 30s on short-text save"
```

---

## Chunk 4: Manual verification

### Task 5: Verify end-to-end behaviour

No automated test infrastructure exists. Verify manually:

- [ ] **Step 1: Confirm debounce resets on rapid saves**

```bash
PGPASSWORD=your-super-secret-and-long-postgres-password \
  psql -h 127.0.0.1 -U postgres -d dino \
  -c "SELECT submission_id, status, process_after, created_at FROM ai_marking_queue ORDER BY created_at DESC LIMIT 5;"
```

1. As a pupil, save a short-text answer.
2. Immediately run the query above — expect one `pending` row with `process_after` ~30s in the future.
3. Save again within 30s.
4. Run the query again — expect the **same row** (same `queue_id`) with `process_after` reset to ~30s from now. No duplicate row.

- [ ] **Step 2: Confirm manual bulk marking is unaffected (no delay)**

1. As a teacher, trigger bulk AI marking from the assignments page.
2. Check the queue:

```bash
PGPASSWORD=your-super-secret-and-long-postgres-password \
  psql -h 127.0.0.1 -U postgres -d dino \
  -c "SELECT submission_id, status, process_after FROM ai_marking_queue WHERE status = 'pending' ORDER BY created_at DESC LIMIT 5;"
```

Expected: `process_after` is at or before `now()` — items are eligible immediately.

- [ ] **Step 3: Push**

```bash
git push
```

---

## Summary of changes

| Commit | What it does |
|---|---|
| `feat: add process_after column to ai_marking_queue` | Schema migration |
| `feat: support debounce delay in enqueueMarkingTasks` | Queue upsert logic |
| `feat: queue processor respects process_after debounce timestamp` | Processor filter |
| `feat: debounce auto AI marking by 30s on short-text save` | Wire-up in save action |
