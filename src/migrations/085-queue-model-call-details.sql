-- 085-queue-model-call-details.sql
--
-- Record what was sent to the model, what came back, and how long it took, on
-- the queue row itself — so marking can be reviewed and costed without adding a
-- separate log table.
--
-- Requires 084-drain-n8n-marking-queue.sql.

BEGIN;

ALTER TABLE external_jobs
  ADD COLUMN IF NOT EXISTS model_request jsonb,
  ADD COLUMN IF NOT EXISTS model_response jsonb,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

COMMENT ON COLUMN external_jobs.model_request IS
  'What was sent to the model: prompt, system text, and per-image metadata. Base64 image data is deliberately NOT stored — a worksheet request is several MB of it.';

COMMENT ON COLUMN external_jobs.model_response IS
  'What came back: the parsed marks and feedback, plus the raw reply (truncated).';

COMMENT ON COLUMN external_jobs.duration_ms IS
  'Wall-clock milliseconds for the model call, including retries.';

-- Reviewing recent marking runs, newest first.
CREATE INDEX IF NOT EXISTS idx_external_jobs_ai_mark_recent
  ON external_jobs (updated_at DESC)
  WHERE job_type = 'ai_mark';

COMMIT;
