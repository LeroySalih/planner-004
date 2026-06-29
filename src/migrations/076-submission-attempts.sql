-- 076-submission-attempts.sql
ALTER TABLE public.submissions
  ADD COLUMN attempt_number integer;

-- Backfill: existing duplicate (activity_id, user_id) rows predate the
-- insert-only model, so assign sequential attempt numbers ordered by
-- submitted_at instead of flatly defaulting to 1 (which would collide).
WITH ranked AS (
  SELECT submission_id,
         row_number() OVER (
           PARTITION BY activity_id, user_id
           ORDER BY submitted_at NULLS FIRST, replication_pk
         ) AS rn
  FROM public.submissions
)
UPDATE public.submissions s
SET attempt_number = ranked.rn
FROM ranked
WHERE s.submission_id = ranked.submission_id
  AND s.attempt_number IS NULL;

ALTER TABLE public.submissions
  ALTER COLUMN attempt_number SET NOT NULL,
  ALTER COLUMN attempt_number SET DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_activity_user_attempt_uq
  ON public.submissions (activity_id, user_id, attempt_number);

CREATE TABLE IF NOT EXISTS public.submission_resubmit_requests (
  activity_id text NOT NULL,
  user_id text NOT NULL,
  requested boolean NOT NULL DEFAULT true,
  note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by text,
  PRIMARY KEY (activity_id, user_id)
);
