-- 128-release-stalled-marking.sql
--
-- Submissions left at 'waiting' or 'marking' with no unfinished ai_mark job.
-- Nothing will ever move them on, so the AI queue page counted them as work in
-- progress and teachers saw "Marking…" on work that was never going to be marked.
--
-- Earlier attempts: the pupil resubmitted before the mark arrived. Scores only
-- ever use the latest attempt, so these are cleared to no status, the same as
-- an attempt that was never sent for marking.
--
-- Latest attempts: marking stopped part way (for example a job that kept
-- failing on an activity with no task). These become 'marking-error' so the
-- teacher can resend them. Re-queuing here would skip the per-criterion
-- fan-out, which lives in enqueueMarkingTasks.
--
-- Anything submitted in the last hour is left alone: a fresh submission is
-- saved before its jobs are enqueued.

BEGIN;

CREATE TEMP TABLE stalled ON COMMIT DROP AS
SELECT s.submission_id,
       s.submission_id = (
         SELECT l.submission_id FROM submissions l
          WHERE l.activity_id = s.activity_id AND l.user_id = s.user_id
          ORDER BY l.attempt_number DESC, l.submitted_at DESC NULLS LAST, l.submission_id DESC
          LIMIT 1
       ) AS is_latest
  FROM submissions s
 WHERE s.mark_status IN ('waiting', 'marking')
   AND s.submitted_at < now() - interval '1 hour'
   AND NOT EXISTS (
     SELECT 1 FROM external_jobs j
      WHERE j.job_type = 'ai_mark'
        AND j.payload->>'submissionId' = s.submission_id
        AND j.status IN ('pending', 'processing')
   );

UPDATE submissions s
   SET mark_status = NULL, mark_error = NULL
  FROM stalled
 WHERE stalled.submission_id = s.submission_id AND NOT stalled.is_latest;

UPDATE submissions s
   SET mark_status = 'marking-error',
       mark_error = 'Marking stopped before it finished. Resend the work for marking.'
  FROM stalled
 WHERE stalled.submission_id = s.submission_id AND stalled.is_latest;

COMMIT;
