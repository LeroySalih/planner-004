-- 134-assessment-paper-v2.sql
--
-- Assessment paper marking v2 (docs/plans/2026-11-01-assessment-paper-activity.md,
-- "Marking v2"): a front sheet instead of a drawn name area, one read per
-- script, then one mark per question.
--
--   * activity_questions.marking: who marks the question. 'ai' (the model),
--     'ai_check' (the model, then listed for the teacher to confirm) or
--     'teacher' (never sent).
--   * activity_questions.depends_on_question_id: error carried forward. The
--     earlier question's answer is shown to the marker beside this one's.
--   * submission_question_answers: what the reader found for each question on
--     a pupil's script. pages are 1-based page numbers of the whole script, so
--     never 1 (the front sheet is never read).
--   * assessment_scripts.page_paths (was redacted_paths): the markable pages,
--     pages 2..n of the script as PNGs. Page 1, the front sheet, is never
--     stored as a page. front_sheet_check: null until checked, 'passed', or
--     the reason the script was held.
--   * The name area is gone: body_data.redaction is removed from every paper.
--
-- external_jobs.job_type has no check constraint, so 'ai_read' needs none.
-- No unit-audit trigger on submission_question_answers: like the other
-- submission tables in 132, it is pupil work, not lesson content.

BEGIN;

ALTER TABLE activity_questions
  ADD COLUMN IF NOT EXISTS marking text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS depends_on_question_id uuid
    REFERENCES activity_questions(question_id) ON DELETE SET NULL;

ALTER TABLE activity_questions DROP CONSTRAINT IF EXISTS activity_questions_marking_check;
ALTER TABLE activity_questions
  ADD CONSTRAINT activity_questions_marking_check CHECK (marking IN ('ai', 'ai_check', 'teacher'));

ALTER TABLE activity_questions DROP CONSTRAINT IF EXISTS activity_questions_depends_on_not_self;
ALTER TABLE activity_questions
  ADD CONSTRAINT activity_questions_depends_on_not_self CHECK (depends_on_question_id <> question_id);

CREATE TABLE IF NOT EXISTS submission_question_answers (
  submission_id text NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES activity_questions(question_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('text', 'sketch', 'mixed')),
  transcription text,
  pages integer[] NOT NULL DEFAULT '{}' CHECK (2 <= ALL (pages)),
  status text NOT NULL CHECK (status IN ('answered', 'blank', 'unreadable', 'continued')),
  provenance text NOT NULL CHECK (provenance IN ('ai', 'teacher')),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (submission_id, question_id)
);
CREATE INDEX IF NOT EXISTS submission_question_answers_question_idx
  ON submission_question_answers (question_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'assessment_scripts' AND column_name = 'redacted_paths') THEN
    ALTER TABLE assessment_scripts RENAME COLUMN redacted_paths TO page_paths;
  END IF;
END $$;

ALTER TABLE assessment_scripts ADD COLUMN IF NOT EXISTS front_sheet_check text;

-- Scripts stored under the name-area scheme had pages with page 1 painted
-- over; none is markable now. (Folded papers' scripts were stored with none.)
UPDATE assessment_scripts SET page_paths = '{}' WHERE front_sheet_check IS NULL AND cardinality(page_paths) > 0;

UPDATE activities SET body_data = body_data - 'redaction'
 WHERE is_question_marked_activity_type(type) AND body_data ? 'redaction';

COMMIT;
