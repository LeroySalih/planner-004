-- 127-flag-latest-attempt-only.sql
--
-- A pupil flags feedback for their teacher to check again, and only the
-- feedback on their latest attempt can be flagged. A new attempt replaces the
-- old feedback, so a flag left on an earlier attempt would ask the teacher to
-- re-check something the pupil has moved on from.
--
-- A trigger rather than code: every submit path inserts a new attempt row, and
-- there are many of them, so clearing the flag here covers them all.
-- The server action refuses to flag anything but the latest attempt.

BEGIN;

CREATE OR REPLACE FUNCTION submissions_clear_earlier_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE submissions
     SET is_flagged = false
   WHERE activity_id = NEW.activity_id
     AND user_id = NEW.user_id
     AND submission_id <> NEW.submission_id
     AND is_flagged;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS submissions_clear_earlier_flags ON submissions;
CREATE TRIGGER submissions_clear_earlier_flags
  AFTER INSERT ON submissions FOR EACH ROW
  EXECUTE FUNCTION submissions_clear_earlier_flags();

-- Existing flags on attempts that are no longer the latest.
UPDATE submissions s
   SET is_flagged = false
  FROM (
    SELECT submission_id,
           row_number() OVER (
             PARTITION BY activity_id, user_id
             ORDER BY attempt_number DESC, submitted_at DESC NULLS LAST, submission_id DESC
           ) AS rank
      FROM submissions
  ) ranked
 WHERE ranked.submission_id = s.submission_id
   AND ranked.rank > 1
   AND s.is_flagged;

COMMIT;
