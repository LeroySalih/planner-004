-- 104-assessments.sql
--
-- Assessments: written papers marked outside a lesson (e.g. "Practice B"),
-- kept apart from lesson submissions and from every existing report.
--
-- A paper declares its own learning objectives (LO1, LO2, ...) in the words
-- printed on it. Each may be linked to at most one curriculum learning
-- objective, and that link can change later without touching a single
-- question or mark: questions belong to the paper's objective, not to the
-- curriculum's.
--
-- Totals and per-objective subtotals are never stored. They are summed from
-- the marks every time, so they cannot disagree with the question rows.
--
-- Not to be confused with assessment_objectives (the curriculum's AOs).

BEGIN;

CREATE TABLE IF NOT EXISTS assessments (
  assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  assessed_on date NOT NULL,
  curriculum_id text NOT NULL REFERENCES curricula(curriculum_id),
  -- Pupils see nothing until a teacher releases the feedback.
  feedback_visible boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE assessments IS
  'A written paper marked outside a lesson. Results are separate from lesson submissions and reports.';

CREATE TABLE IF NOT EXISTS assessment_groups (
  assessment_id uuid NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  PRIMARY KEY (assessment_id, group_id)
);

CREATE INDEX IF NOT EXISTS assessment_groups_group_idx ON assessment_groups (group_id);

-- The paper's own objectives. learning_objective_id is the optional one-to-one
-- link to the curriculum: NULL means "not linked yet", and a curriculum
-- objective can be linked once per paper (NULLs do not collide in UNIQUE).
-- That it belongs to the paper's curriculum is checked by the app, since a
-- CHECK cannot reach across tables.
CREATE TABLE IF NOT EXISTS assessment_learning_objectives (
  assessment_lo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
  code text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  learning_objective_id text REFERENCES learning_objectives(learning_objective_id) ON DELETE SET NULL,
  CONSTRAINT assessment_los_code_unique UNIQUE (assessment_id, code),
  CONSTRAINT assessment_los_link_unique UNIQUE (assessment_id, learning_objective_id),
  -- Target for the questions' composite key below.
  CONSTRAINT assessment_los_id_in_paper UNIQUE (assessment_id, assessment_lo_id)
);

COMMENT ON COLUMN assessment_learning_objectives.code IS
  'Label printed on the paper, e.g. LO1. Questions and MCP tools refer to the objective by this code.';
COMMENT ON COLUMN assessment_learning_objectives.learning_objective_id IS
  'One-to-one link to a curriculum learning objective in the paper''s curriculum. NULL = not linked yet.';

-- The composite foreign key makes it impossible for a question to point at
-- another paper's objective.
CREATE TABLE IF NOT EXISTS assessment_questions (
  question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL,
  max_marks integer NOT NULL CHECK (max_marks >= 1),
  assessment_lo_id uuid NOT NULL,
  correct_answer text,
  CONSTRAINT assessment_questions_label_unique UNIQUE (assessment_id, label),
  CONSTRAINT assessment_questions_id_in_paper UNIQUE (assessment_id, question_id),
  CONSTRAINT assessment_questions_lo_fk FOREIGN KEY (assessment_id, assessment_lo_id)
    REFERENCES assessment_learning_objectives (assessment_id, assessment_lo_id)
);

-- One mark per pupil per question. provenance decides who wins on a re-import:
-- a model ('ai') never overwrites a mark a teacher has changed ('teacher').
CREATE TABLE IF NOT EXISTS assessment_question_marks (
  assessment_id uuid NOT NULL,
  question_id uuid NOT NULL,
  pupil_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  awarded integer NOT NULL CHECK (awarded >= 0),
  why_not_awarded text,
  how_to_improve text,
  provenance text NOT NULL CHECK (provenance IN ('ai', 'teacher')),
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, pupil_id),
  CONSTRAINT assessment_marks_question_fk FOREIGN KEY (assessment_id, question_id)
    REFERENCES assessment_questions (assessment_id, question_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS assessment_marks_pupil_idx
  ON assessment_question_marks (assessment_id, pupil_id);

-- A mark above the question's maximum is refused here as well as in the app,
-- and a question's maximum cannot drop below a mark already given.
CREATE OR REPLACE FUNCTION assessment_mark_within_max() RETURNS trigger AS $$
BEGIN
  IF NEW.awarded > (SELECT max_marks FROM assessment_questions WHERE question_id = NEW.question_id) THEN
    RAISE EXCEPTION 'Mark % exceeds the maximum for question %', NEW.awarded, NEW.question_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assessment_mark_within_max ON assessment_question_marks;
CREATE TRIGGER assessment_mark_within_max
  BEFORE INSERT OR UPDATE OF awarded, question_id ON assessment_question_marks
  FOR EACH ROW EXECUTE FUNCTION assessment_mark_within_max();

CREATE OR REPLACE FUNCTION assessment_max_covers_marks() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM assessment_question_marks
    WHERE question_id = NEW.question_id AND awarded > NEW.max_marks
  ) THEN
    RAISE EXCEPTION 'Question % already has a mark above %', NEW.label, NEW.max_marks;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assessment_max_covers_marks ON assessment_questions;
CREATE TRIGGER assessment_max_covers_marks
  BEFORE UPDATE OF max_marks ON assessment_questions
  FOR EACH ROW EXECUTE FUNCTION assessment_max_covers_marks();

-- Whole-paper comments for one pupil.
CREATE TABLE IF NOT EXISTS assessment_pupil_feedback (
  assessment_id uuid NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
  pupil_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  went_well text[] NOT NULL DEFAULT '{}',
  targets text[] NOT NULL DEFAULT '{}',
  provenance text NOT NULL CHECK (provenance IN ('ai', 'teacher')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, pupil_id)
);

COMMIT;
