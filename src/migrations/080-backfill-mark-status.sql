-- Backfill mark_status for previous attempts: any AI-marked submission that
-- already has a computable score is 'marked'. Idempotent (only touches NULLs).
BEGIN;

UPDATE public.submissions s
SET mark_status = 'marked'
FROM public.activities a
WHERE a.activity_id = s.activity_id
  AND s.mark_status IS NULL
  AND a.type IN ('short-text-question', 'upload-worksheet', 'upload-spreadsheet')
  AND compute_submission_base_score(s.body, a.type) IS NOT NULL;

COMMIT;
