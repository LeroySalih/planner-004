-- 132-assessment-paper-activity.sql
--
-- An assessment paper becomes an activity in a lesson ('assessment-paper').
-- It is marked question by question, and each question splits its marks
-- across the success criteria it tests (Q3 = 4 -> SC-A 2 + SC-B 2). The
-- question marks are the source of truth; the submission's body and its
-- submission_sc_marks rows are derived from them by
-- recomputeAssessmentSubmission (src/lib/assessment-paper/store.ts), so the
-- result reads like any other activity in every report.
--
-- Because those totals are derived from questions, not criteria, the
-- criterion machinery must leave them alone. is_question_marked_activity_type
-- exempts the type from:
--   * refresh_submission_sc_total (returns early)
--   * set_all_criteria_marks (returns early)
--   * the activity_success_criteria trigger (the store keeps the links in sync
--     with the questions, and recomputes itself)
--   * refresh_criterion_marks (a criterion's marks available here are its
--     allocation in a question, not its type's)
-- Everything else in those functions is unchanged from 129-131.
--
-- assessment_scripts holds each pupil's uploaded script. script_id is opaque:
-- it is the only id the marking model ever sees.

BEGIN;

-- Keep in step with QUESTION_MARKED_ACTIVITY_TYPES in src/dino.config.ts.
CREATE OR REPLACE FUNCTION is_question_marked_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_type, ''))) = ANY (ARRAY['assessment-paper'])
$$;

-- Keep in step with SCORABLE_ACTIVITY_TYPES in src/dino.config.ts.
CREATE OR REPLACE FUNCTION is_scorable_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_type, ''))) = ANY (ARRAY[
    'multiple-choice-question', 'short-text-question', 'text-question',
    'long-text-question', 'upload-file', 'upload-url', 'upload-spreadsheet',
    'upload-code', 'upload-worksheet', 'mark-worksheet', 'feedback',
    'sketch-render', 'do-flashcards', 'matcher', 'group-items', 'voice',
    'sequence', 'assessment-paper'
  ])
$$;

CREATE TABLE IF NOT EXISTS activity_questions (
  question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id text NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  position integer NOT NULL DEFAULT 0,
  max_marks integer NOT NULL CHECK (max_marks >= 1),
  question_text text,
  mark_scheme text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (activity_id, label)
);

-- The split. Invariant, enforced in setAssessmentQuestions: a question's
-- allocations sum to its max_marks.
CREATE TABLE IF NOT EXISTS activity_question_criteria (
  question_id uuid NOT NULL REFERENCES activity_questions(question_id) ON DELETE CASCADE,
  success_criteria_id text NOT NULL REFERENCES success_criteria(success_criteria_id) ON DELETE RESTRICT,
  max_marks integer NOT NULL CHECK (max_marks >= 1),
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, success_criteria_id)
);
CREATE INDEX IF NOT EXISTS activity_question_criteria_sc_idx
  ON activity_question_criteria (success_criteria_id);

-- A question's mark: the sum of its criterion rows, or, for a paper folded in
-- from the old assessments module, the old mark itself ('legacy').
CREATE TABLE IF NOT EXISTS submission_question_marks (
  submission_id text NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES activity_questions(question_id) ON DELETE CASCADE,
  awarded integer NOT NULL CHECK (awarded >= 0),
  available integer NOT NULL CHECK (available >= 1),
  provenance text NOT NULL CHECK (provenance IN ('ai', 'teacher', 'legacy')),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (submission_id, question_id),
  CHECK (awarded <= available)
);
CREATE INDEX IF NOT EXISTS submission_question_marks_question_idx
  ON submission_question_marks (question_id);

-- One criterion within one question. available is the criterion's allocation
-- in the question; on a legacy question it is the question's own marks (the
-- old split is unknown, so every criterion records the question's mark).
-- teacher_feedback sits beside the marker's comments, as on
-- submission_sc_marks, so a teacher's comment never erases the AI's.
CREATE TABLE IF NOT EXISTS submission_question_criterion_marks (
  submission_id text NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  success_criteria_id text NOT NULL,
  awarded integer NOT NULL CHECK (awarded >= 0),
  available integer NOT NULL CHECK (available >= 1),
  why_not_awarded text,
  how_to_improve text,
  teacher_feedback text,
  provenance text NOT NULL CHECK (provenance IN ('ai', 'teacher', 'legacy')),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (submission_id, question_id, success_criteria_id),
  FOREIGN KEY (question_id, success_criteria_id)
    REFERENCES activity_question_criteria(question_id, success_criteria_id) ON DELETE CASCADE,
  CHECK (awarded <= available)
);
CREATE INDEX IF NOT EXISTS submission_question_criterion_marks_q_sc_idx
  ON submission_question_criterion_marks (question_id, success_criteria_id);

CREATE TABLE IF NOT EXISTS assessment_scripts (
  script_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id text NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
  pupil_id text NOT NULL,
  submission_id text REFERENCES submissions(submission_id) ON DELETE SET NULL,
  original_path text NOT NULL,
  redacted_paths text[] NOT NULL DEFAULT '{}',
  page_count integer NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS assessment_scripts_activity_pupil_idx
  ON assessment_scripts (activity_id, pupil_id);
CREATE INDEX IF NOT EXISTS assessment_scripts_submission_idx
  ON assessment_scripts (submission_id);

-- Questions are lesson content, so editing them makes the unit's audit stale
-- (migration 123). activity_question_criteria has no activity_id of its own,
-- so it reaches the lesson through its question.
DROP TRIGGER IF EXISTS unit_audits_activity_questions ON activity_questions;
CREATE TRIGGER unit_audits_activity_questions
  AFTER INSERT OR DELETE OR UPDATE ON activity_questions
  FOR EACH ROW EXECUTE FUNCTION unit_audits_on_change('activity');

CREATE OR REPLACE FUNCTION activity_question_criteria_audit_on_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;
  PERFORM unit_audit_touch_lesson(a.lesson_id)
     FROM activity_questions q
     JOIN activities a ON a.activity_id = q.activity_id
    WHERE q.question_id IN (OLD.question_id, NEW.question_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS unit_audits_activity_question_criteria ON activity_question_criteria;
CREATE TRIGGER unit_audits_activity_question_criteria
  AFTER INSERT OR DELETE OR UPDATE ON activity_question_criteria
  FOR EACH ROW EXECUTE FUNCTION activity_question_criteria_audit_on_change();

-- 130's definition, plus the question-marked exemption.
CREATE OR REPLACE FUNCTION refresh_submission_sc_total(p_submission_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_awarded integer;
  v_available integer;
  v_scores jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM submissions s JOIN activities a ON a.activity_id = s.activity_id
              WHERE s.submission_id = p_submission_id
                AND (is_self_marking_activity_type(a.type) OR is_question_marked_activity_type(a.type))) THEN
    RETURN;
  END IF;

  SELECT sum(m.awarded)::int, sum(m.available)::int,
         jsonb_object_agg(m.success_criteria_id, m.awarded::numeric / m.available)
    INTO v_awarded, v_available, v_scores
    FROM submissions s
    JOIN activity_success_criteria acs ON acs.activity_id = s.activity_id
    JOIN submission_sc_marks m
      ON m.submission_id = s.submission_id AND m.success_criteria_id = acs.success_criteria_id
   WHERE s.submission_id = p_submission_id;

  IF v_available IS NULL OR v_available = 0 THEN
    RETURN;
  END IF;

  UPDATE submissions
     SET body = ((coalesce(body::jsonb, '{}'::jsonb)
                   - ARRAY['marks_override', 'teacher_override_score', 'override_score',
                           'teacher_ai_marks', 'teacher_ai_score'])
                 || jsonb_build_object(
                      'marks', v_awarded,
                      'ai_marks', v_awarded,
                      'sc_marks_awarded', v_awarded,
                      'sc_marks_available', v_available,
                      'ai_model_score', round(v_awarded::numeric / v_available, 4),
                      'score', round(v_awarded::numeric / v_available, 4),
                      'success_criteria_scores', v_scores))::json
   WHERE submission_id = p_submission_id;
END $$;

-- 131's definition, plus the question-marked exemption: filling every
-- criterion with full-or-0 would write marks out of the criterion's type, not
-- its allocations, and they would never add up to the questions.
CREATE OR REPLACE FUNCTION set_all_criteria_marks(p_submission_id text, p_full boolean, p_replace boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM submissions s JOIN activities a ON a.activity_id = s.activity_id
              WHERE s.submission_id = p_submission_id AND is_question_marked_activity_type(a.type)) THEN
    RETURN;
  END IF;

  IF p_replace THEN
    INSERT INTO submission_sc_marks (submission_id, success_criteria_id, awarded, available, provenance)
    SELECT s.submission_id, acs.success_criteria_id,
           CASE WHEN p_full THEN sc_available_marks(acs.success_criteria_id) ELSE 0 END,
           sc_available_marks(acs.success_criteria_id), 'teacher'
      FROM submissions s
      JOIN activity_success_criteria acs ON acs.activity_id = s.activity_id
     WHERE s.submission_id = p_submission_id
    ON CONFLICT (submission_id, success_criteria_id) DO UPDATE
       SET awarded = excluded.awarded, available = excluded.available,
           provenance = 'teacher', feedback = NULL, marked_at = timezone('utc', now());
  ELSE
    INSERT INTO submission_sc_marks (submission_id, success_criteria_id, awarded, available, provenance)
    SELECT s.submission_id, acs.success_criteria_id,
           CASE WHEN p_full THEN sc_available_marks(acs.success_criteria_id) ELSE 0 END,
           sc_available_marks(acs.success_criteria_id), 'legacy'
      FROM submissions s
      JOIN activity_success_criteria acs ON acs.activity_id = s.activity_id
     WHERE s.submission_id = p_submission_id
    ON CONFLICT (submission_id, success_criteria_id) DO NOTHING;
  END IF;

  PERFORM refresh_submission_sc_total(p_submission_id);
END $$;

-- 129's definition, plus the question-marked exemption.
CREATE OR REPLACE FUNCTION activity_success_criteria_marks_on_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_activity_id text := coalesce(NEW.activity_id, OLD.activity_id);
  v_type text;
  v_max integer;
  r record;
BEGIN
  SELECT a.type, coalesce(a.max_marks, 1) INTO v_type, v_max
    FROM activities a WHERE a.activity_id = v_activity_id;

  IF v_type IS NULL OR is_self_marking_activity_type(v_type) OR NOT is_scorable_activity_type(v_type)
     OR is_question_marked_activity_type(v_type) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    FOR r IN
      SELECT DISTINCT m.submission_id
        FROM submission_sc_marks m
        JOIN submissions s ON s.submission_id = m.submission_id
       WHERE s.activity_id = v_activity_id AND m.success_criteria_id = OLD.success_criteria_id
    LOOP
      PERFORM refresh_submission_sc_total(r.submission_id);
    END LOOP;
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT ON (s.user_id) s.submission_id,
           compute_submission_marks(s.body::jsonb, v_type, v_max) AS marks
      FROM submissions s
     WHERE s.activity_id = v_activity_id
     ORDER BY s.user_id, s.attempt_number DESC, s.submitted_at DESC NULLS LAST, s.submission_id DESC
  LOOP
    IF r.marks IS NOT NULL THEN
      PERFORM set_all_criteria_marks(r.submission_id, r.marks >= v_max, false);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- 130's definition, plus: rows on a question-marked activity are left alone.
-- Their marks available are the criterion's allocation in its questions, which
-- a change of type or levels does not move.
CREATE OR REPLACE FUNCTION refresh_criterion_marks(p_success_criteria_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_available integer := sc_available_marks(p_success_criteria_id);
  v_submissions text[];
  v_submission_id text;
BEGIN
  IF v_available IS NULL THEN
    RETURN 0;
  END IF;

  WITH changed AS (
    UPDATE submission_sc_marks m
       SET awarded = CASE WHEN m.awarded >= m.available THEN v_available
                          ELSE least(m.awarded, v_available - 1) END,
           available = v_available
     WHERE m.success_criteria_id = p_success_criteria_id
       AND m.available <> v_available
       AND NOT EXISTS (SELECT 1 FROM submissions s JOIN activities a ON a.activity_id = s.activity_id
                        WHERE s.submission_id = m.submission_id
                          AND is_question_marked_activity_type(a.type))
    RETURNING m.submission_id
  )
  SELECT coalesce(array_agg(DISTINCT submission_id), '{}') INTO v_submissions FROM changed;

  FOREACH v_submission_id IN ARRAY v_submissions LOOP
    PERFORM refresh_submission_sc_total(v_submission_id);
  END LOOP;

  RETURN cardinality(v_submissions);
END $$;

-- Marked by a model like the other AI-marked types (migration 089). Copies
-- upload-worksheet's route, the nearest type, when there is one.
INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'assessment-paper', NULL,
       coalesce(r.provider, 'anthropic'), coalesce(r.model, 'claude-sonnet-5'), r.effort,
       'migration-132'
  FROM (SELECT 1) one
  LEFT JOIN ai_model_routes r ON r.activity_type = 'upload-worksheet' AND r.sc_type IS NULL
ON CONFLICT (activity_type) WHERE sc_type IS NULL DO NOTHING;

COMMIT;
