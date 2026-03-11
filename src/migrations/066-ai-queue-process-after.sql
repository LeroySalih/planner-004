-- src/migrations/066-ai-queue-process-after.sql
ALTER TABLE ai_marking_queue
  ADD COLUMN IF NOT EXISTS process_after timestamptz NOT NULL DEFAULT now();

-- Back-fill existing rows so they are immediately eligible
UPDATE ai_marking_queue SET process_after = now() WHERE process_after > now();
