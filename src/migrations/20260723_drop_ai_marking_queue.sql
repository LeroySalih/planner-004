-- Marking is now backed by the unified external_jobs table (job_type='ai_mark').
-- The dedicated ai_marking_queue table is no longer read or written by any code.
-- Apply AFTER deploying the code that migrates marking onto external_jobs.
DROP TABLE IF EXISTS public.ai_marking_queue;
