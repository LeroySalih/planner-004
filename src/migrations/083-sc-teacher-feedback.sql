-- 083-sc-teacher-feedback.sql
--
-- Teacher marks AND comments always override the AI's.
--
-- Until now a teacher could change a criterion's mark but not its comment, so
-- a criterion raised from 2 to 3 still displayed the AI's "You earned 2 marks
-- because..." underneath it — an explanation of a mark that no longer stood.
--
-- `feedback` keeps its meaning: the AI's comment, preserved so a mark can be
-- reverted and so the AI's reasoning stays auditable. `teacher_feedback` is
-- the override and wins wherever a comment is displayed.
--
-- Requires 081-multi-sc.sql.

BEGIN;

ALTER TABLE submission_sc_marks
  ADD COLUMN IF NOT EXISTS teacher_feedback text;

COMMENT ON COLUMN submission_sc_marks.feedback IS
  'The AI marker''s comment for this criterion. Superseded for display by teacher_feedback.';

COMMENT ON COLUMN submission_sc_marks.teacher_feedback IS
  'Teacher override comment. Always wins over feedback when shown to pupils or teachers.';

COMMIT;
