# Plan: Persistent AI Marking Queue (v000)

## 1. Objective
Replace the current synchronous AI marking trigger with a persistent Postgres-backed queue to prevent timeouts and dropped requests when processing batches. Use a recursive, sequential processing model to maintain stability.

## 2. Current Flow Analysis
1. **Trigger**: Teacher clicks "Mark with AI" or "Mark All" in `/results/assignments/[id]`.
2. **Action**: `handleColumnAiMark` calls `triggerManualAiMarkingAction`.
3. **Server Action**: `triggerManualAiMarkingAction` calls `runAiMarkingFlow` (fire-and-forget).
4. **Issue**: Spawning multiple concurrent outgoing HTTP requests causes reliability issues.

## 3. Proposed Architecture

### A. Database Schema
A new table `ai_marking_queue` to track individual marking tasks.
- `queue_id`: uuid (PK)
- `submission_id`: uuid (FK)
- `assignment_id`: text (for SSE routing)
- `status`: text (`pending`, `processing`, `completed`, `failed`)
- `attempts`: int (default 0)
- `last_error`: text
- `created_at`: timestamptz
- `updated_at`: timestamptz

### B. The Flow
1. **Enqueueing**: `triggerManualAiMarkingAction` performs a bulk insert into `ai_marking_queue` with status `pending`.
2. **First Trigger**: After insertion, it sends a non-blocking `fetch` to `/api/marking/process-queue`.
3. **Manager Execution (Sequential)**:
    - Finds **exactly one** `pending` row using `SELECT ... FOR UPDATE SKIP LOCKED`.
    - Marks it `processing`.
    - Triggers the DO function asynchronously.
4. **Self-Chaining (Recursive)**:
    - Manager checks for remaining `pending` rows.
    - If found, sends a fresh background `fetch` to itself and returns `200 OK`.
5. **DO Callback**: DO function processes work and calls `/app/webhooks/ai-mark/route.ts` with the result wrapped in an array.
6. **Resolution & Cleanup**: 
    - Webhook updates `submissions` and emits SSE event.
    - Webhook marks the queue item as `completed`.
    - **Pruning**: Every execution of the Queue Manager will delete `completed` rows older than 7 days.

## 4. Security & Configuration
- **MARKING_QUEUE_SECRET**: Shared secret for `/api/marking/process-queue` authorization.
- **AI_MARKING_CALLBACK_URL**: Configurable URL sent to DO so it knows where to POST results (useful for ngrok/local testing).
- **Internal Auth**: Manager requests must include `Authorization: Bearer <MARKING_QUEUE_SECRET>`.

## 5. Resilience
- **Atomic Locks**: Prevents duplicate processing via Postgres row-level locking.
- **Retry Logic**: Max **3 attempts**. If it fails 3 times, status is set to `failed`.
- **Stuck Row Recovery**: Rows in `processing` for > 10 mins are reset to `pending`.
- **Deduplication**: Prevent queueing if a `pending`/`processing` row already exists for a `submission_id`.

## 6. Monitoring & Debugging
- **New Page**: `/ai-queue`
    - Displays a table of the `ai_marking_queue`.
    - Shows stats (Total pending, failed today, avg processing time).
    - Allows manual "Retry" for failed items.

## 7. Next Steps
- [ ] Implement `ai_marking_queue` table migration.
- [ ] Create `/api/marking/process-queue` with self-chaining and pruning.
- [ ] Create `/ai-queue` monitoring page.
- [ ] Update `triggerManualAiMarkingAction` to use the queue.
- [ ] Update `/app/webhooks/ai-mark/route.ts` to resolve queue items.
