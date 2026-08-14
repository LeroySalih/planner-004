-- 084-drain-n8n-marking-queue.sql
--
-- Cutover migration for the removal of n8n from the marking pipeline.
--
-- Under the old design a claimed job was POSTed to n8n and the worker returned
-- immediately; the result arrived later on /webhooks/ai-mark. Those webhook
-- routes no longer exist, so any job that was already in flight when this
-- deploy lands will never receive its callback. Its submission would sit in
-- 'marking' until recoverStuckItems swept it, ten minutes later.
--
-- This resets in-flight work so the new direct-call worker picks it up on its
-- next tick instead. Nothing is discarded: the jobs return to the pending pool
-- with their payloads intact.
--
-- Safe to re-run. Re-marking is idempotent — submission_sc_marks upserts by
-- (submission_id, success_criteria_id) and skips rows a teacher has overridden
-- (provenance='teacher'), so a pupil cannot lose a teacher's mark or comment to
-- a repeat run.
--
-- Requires 083-sc-teacher-feedback.sql.

BEGIN;

-- 1. Return in-flight ai_mark jobs to the pending pool.
UPDATE external_jobs
SET status = 'pending',
    process_after = now(),
    last_error = 'Requeued by 084: n8n callback path removed',
    updated_at = now()
WHERE job_type = 'ai_mark'
  AND status = 'processing';

-- 2. Reset the submissions those jobs belong to, so the claim query can pick
--    them up again (it requires mark_status in ('waiting','marking')).
UPDATE submissions
SET mark_status = 'waiting',
    mark_error = null
WHERE mark_status = 'marking'
  AND submission_id IN (
    SELECT payload ->> 'submissionId'
    FROM external_jobs
    WHERE job_type = 'ai_mark' AND status = 'pending'
  );

-- 3. Same for revision answers, which have their own status lifecycle.
UPDATE revision_answers
SET status = 'pending_marking'
WHERE status = 'marking'
  AND answer_id IN (
    SELECT (payload ->> 'submissionId')::uuid
    FROM external_jobs
    WHERE job_type = 'ai_mark'
      AND status = 'pending'
      AND payload ->> 'assignmentId' = 'revision'
  );

-- 4. Surface submissions stranded in 'marking' with no job behind them.
--
--    These are the residue of the old fire-and-forget design: the work was sent
--    to n8n, no callback ever arrived, and the job row was later pruned. With
--    no job, nothing can claim them — recoverStuckItems only looks at jobs — so
--    they show "being marked" to the pupil indefinitely. On the dev database
--    five mark-worksheet submissions had been in this state for three weeks.
--
--    They are moved to 'marking-error' rather than requeued: the queue payload
--    needs a group assignment identifier, and a migration should not guess one.
--    A teacher can now see them and use AI Mark, which builds it correctly.
UPDATE submissions
SET mark_status = 'marking-error',
    mark_error = 'Marking never completed under the previous pipeline. Please re-mark.'
WHERE mark_status = 'marking'
  AND NOT EXISTS (
    SELECT 1 FROM external_jobs
    WHERE job_type = 'ai_mark'
      AND status IN ('pending', 'processing')
      AND payload ->> 'submissionId' = submissions.submission_id
  );

-- 5. Drop the job type that no longer exists. webhook_apply carried inbound
--    n8n callbacks onto the queue; with no webhooks there is no handler, so any
--    surviving row would fail dispatch forever.
DELETE FROM external_jobs
WHERE job_type = 'webhook_apply';

COMMIT;
