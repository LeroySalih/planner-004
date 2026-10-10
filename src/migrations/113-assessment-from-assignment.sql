-- 113-assessment-from-assignment.sql
--
-- An assignment (a lesson set to a class) can be turned into an assessment
-- paper from the results page. The paper remembers which assignment it came
-- from, and each question which activity, so pressing the button again
-- refreshes the same paper instead of creating a second one.

BEGIN;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS source_group_id text,
  ADD COLUMN IF NOT EXISTS source_lesson_id text;

CREATE UNIQUE INDEX IF NOT EXISTS assessments_source_assignment_unique
  ON assessments (source_group_id, source_lesson_id)
  WHERE active AND source_lesson_id IS NOT NULL;

ALTER TABLE assessment_questions
  ADD COLUMN IF NOT EXISTS source_activity_id text;

COMMENT ON COLUMN assessments.source_lesson_id IS
  'Set when the paper was generated from an assignment (source_group_id + source_lesson_id).';
COMMENT ON COLUMN assessment_questions.source_activity_id IS
  'The lesson activity this question was generated from, if any.';

COMMIT;
