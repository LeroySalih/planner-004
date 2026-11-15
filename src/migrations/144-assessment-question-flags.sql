-- 144-assessment-question-flags.sql
--
-- A pupil flags one question of a question-marked activity (assessment paper,
-- PowerPoint assessment) for their teacher to check, rather than the whole
-- submission: on a paper of twenty marked questions "please look again" is
-- only useful if it says which one.
--
-- One row per flag, kept after it is dealt with, so a teacher (and MCP) can
-- see what happened to it:
--   * open:      withdrawn_at and resolved_at both null. At most one open flag
--                per question per submission.
--   * withdrawn: the pupil unflagged it before a teacher dealt with it.
--   * resolved:  a teacher cleared it (resolved_by, resolved_at).
--
-- The question's marks are snapshotted when it is flagged and when it is
-- resolved (awarded_at_*, marks_at_* as [{success_criteria_id, awarded}]),
-- so whether the teacher changed the mark is derived from the two snapshots
-- and never stored as an outcome of its own.
--
-- submissions.is_flagged stays the submission-level summary the results grid
-- reads: the code keeps it equal to "this submission has an open question
-- flag" on question-marked activities.
--
-- Pupil work, not lesson content: no unit_audits trigger (migration 123).

BEGIN;

CREATE TABLE IF NOT EXISTS submission_question_flags (
  flag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES activity_questions(question_id) ON DELETE CASCADE,
  pupil_id text NOT NULL,
  flagged_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  awarded_at_flag integer,
  marks_at_flag jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(marks_at_flag) = 'array'),
  withdrawn_at timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  awarded_at_resolve integer,
  marks_at_resolve jsonb CHECK (marks_at_resolve IS NULL OR jsonb_typeof(marks_at_resolve) = 'array'),
  CONSTRAINT submission_question_flags_one_ending CHECK (withdrawn_at IS NULL OR resolved_at IS NULL),
  CONSTRAINT submission_question_flags_resolved_by CHECK (resolved_at IS NOT NULL OR resolved_by IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS submission_question_flags_one_open
  ON submission_question_flags (submission_id, question_id)
  WHERE withdrawn_at IS NULL AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS submission_question_flags_submission_idx
  ON submission_question_flags (submission_id, flagged_at);

CREATE INDEX IF NOT EXISTS submission_question_flags_question_open_idx
  ON submission_question_flags (question_id)
  WHERE withdrawn_at IS NULL AND resolved_at IS NULL;

-- A new attempt makes the earlier ones history (migration 127 clears their
-- is_flagged). Their open question flags are closed as withdrawn too, or they
-- would stay open where no screen reads them and no teacher can clear them.
CREATE OR REPLACE FUNCTION submission_question_flags_close_earlier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE submission_question_flags f
     SET withdrawn_at = timezone('utc', now())
    FROM submissions s
   WHERE f.submission_id = s.submission_id
     AND s.activity_id = NEW.activity_id
     AND s.user_id = NEW.user_id
     AND s.submission_id <> NEW.submission_id
     AND f.withdrawn_at IS NULL
     AND f.resolved_at IS NULL;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS submission_question_flags_close_earlier ON submissions;
CREATE TRIGGER submission_question_flags_close_earlier
  AFTER INSERT ON submissions FOR EACH ROW
  EXECUTE FUNCTION submission_question_flags_close_earlier();

COMMIT;
