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

-- Queue: deduplicate (keep newest created_at per submission_id), then drop status
-- column + its indexes/constraint; add plain unique on submission_id.
DELETE FROM public.ai_marking_queue a
USING (
  SELECT submission_id, max(created_at) AS keep_created_at
  FROM public.ai_marking_queue
  GROUP BY submission_id
  HAVING count(*) > 1
) dedup
WHERE a.submission_id = dedup.submission_id
  AND a.created_at < dedup.keep_created_at;

DROP INDEX IF EXISTS idx_ai_marking_queue_unique_active;
DROP INDEX IF EXISTS idx_ai_marking_queue_status;
ALTER TABLE public.ai_marking_queue DROP CONSTRAINT IF EXISTS ai_marking_queue_status_check;
ALTER TABLE public.ai_marking_queue DROP COLUMN IF EXISTS status;
CREATE UNIQUE INDEX IF NOT EXISTS ai_marking_queue_submission_uq ON public.ai_marking_queue (submission_id);

COMMIT;
