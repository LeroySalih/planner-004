-- 152-model-batches.sql
--
-- Message Batches for question marking (Anthropic Message Batches API: half
-- the price, results within 24 hours). Only these jobs may go by batch: the
-- per-question ai_mark of an assessment paper, a PowerPoint and a database
-- assessment, and an assessment paper's ai_read. Never anything else.
--
-- ai_model_routes.use_batch is the switch, on by default (a teacher
-- decision: half the price is worth the wait). It has effect only
-- on the route rows of those jobs (assessment-paper, powerpoint-assessment,
-- database-assessment, surface:assessment-read, surface:assessment-mark-text,
-- surface:powerpoint-mark-text, surface:database-mark-text) and only when the
-- row's provider is anthropic (BATCH_ROUTE_KEYS, src/lib/ai/model-routing.ts).
--
-- model_batch_items holds one prepared request per parked job: the full
-- Messages API body (built by buildClaudeMessageParams, cache flags kept)
-- and what the reply handler needs (context). While the row exists the job
-- stays 'processing' and is "parked": the normal claim takes only 'pending'
-- jobs, and recoverStuckItems skips a job with a row here. So every path
-- that drops or closes an open job (a re-mark, Undo hand in, a file change, a
-- hold) works on a parked job unchanged; deleting the job deletes its row
-- (ON DELETE CASCADE), and a result for a job that has gone, or is no longer
-- 'processing', is dropped. The row is deleted when its result is handled.
-- The body holds the pupil's page images and report text (base64); it lives
-- only until the result comes back.
--
-- model_batches is one row per submitted Message Batch, polled about once a
-- minute until it has ended and its results are handled.
--
-- Pupil work, not lesson content: no unit-audit trigger.

BEGIN;

ALTER TABLE ai_model_routes
  ADD COLUMN IF NOT EXISTS use_batch boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS model_batches (
  batch_id text PRIMARY KEY,
  request_count integer NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'in_progress',
  last_polled_at timestamptz,
  ended_at timestamptz,
  -- Set once every result has been handled: the batch is closed.
  results_handled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_model_batches_open
  ON model_batches (last_polled_at) WHERE results_handled_at IS NULL;

CREATE TABLE IF NOT EXISTS model_batch_items (
  job_id uuid PRIMARY KEY REFERENCES external_jobs(job_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('assessment-mark', 'practical-mark', 'assessment-read')),
  submission_id text NOT NULL,
  question_id uuid,
  request_hash text NOT NULL,
  body jsonb NOT NULL,
  context jsonb NOT NULL,
  batch_id text REFERENCES model_batches(batch_id) ON DELETE SET NULL,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_batch_items_unsubmitted
  ON model_batch_items (created_at) WHERE batch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_model_batch_items_batch
  ON model_batch_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_model_batch_items_submission
  ON model_batch_items (submission_id);

COMMIT;
