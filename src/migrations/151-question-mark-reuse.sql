-- 151-question-mark-reuse.sql
--
-- Do not pay twice for the same mark request. On every question-marked type
-- (assessment paper, PowerPoint and database assessment) the marker
-- fingerprints each mark request just before the model call
-- (src/lib/assessment-paper/mark-reuse.ts: provider, model, effort, system
-- text, response schema, every part in order with each attachment by mime
-- type and sha256 of its bytes, the criteria and allocations, and
-- MARK_REUSE_VERSION). One row per submission and question keeps the latest
-- answered request: its fingerprint and the validated result (rows, the
-- practical marker's evidence note, a hold reason). A mark job whose request
-- has the same fingerprint applies the stored result instead of calling the
-- model.
--
-- The row is written by completeAssessmentQuestionMark, in the transaction
-- that applies the result, so a failed apply stores nothing. Re-marks
-- (clearMarkedQuestionWork, clearForReread, Undo hand in, a file change) do
-- NOT delete it: that is how an unchanged re-mark puts the same marks back.
-- remark_assessment_activity with force deletes it. A new attempt is a new
-- submission, so nothing is reused across attempts.
--
-- Pupil work, not lesson content: no unit-audit trigger.

BEGIN;

CREATE TABLE IF NOT EXISTS submission_question_mark_requests (
  submission_id text NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES activity_questions(question_id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  model text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, question_id)
);

COMMIT;
