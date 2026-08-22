-- 091-chat-call-log-index.sql
--
-- Index the chat call log the same way ai_mark rows are indexed.
--
-- Chat calls now write a `job_type = 'chat'` row to external_jobs recording
-- what was sent to the model and what came back (see model-call-log.ts).
-- Reviewing them means "most recent first", which without this index is a scan
-- of the whole queue table.
--
-- Partial, matching idx_external_jobs_ai_mark_recent: the queue's own hot path
-- filters on status = 'pending', and these rows are always 'done', so they must
-- not bloat the index that path uses.
--
-- No schema change — the columns came with 085. Requires
-- 090-model-surface-routes.sql.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_external_jobs_chat_recent
  ON public.external_jobs (updated_at DESC)
  WHERE job_type = 'chat';

COMMENT ON INDEX public.idx_external_jobs_chat_recent IS
  'Recent-first review of chat model calls. Rows are log entries written with status=done; they are never claimed by the queue and age out on the generic 7-day pruneDoneJobs sweep.';

COMMIT;
