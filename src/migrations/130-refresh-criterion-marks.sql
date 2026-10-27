-- 130-refresh-criterion-marks.sql
--
-- A pupil's criterion mark stores the marks available when it was given
-- (submission_sc_marks.available). When a criterion changes type, or gains or
-- loses levels, those rows were left out of step: a criterion switched from
-- levelled (3) to binary still showed 0-3 on every pupil marked before, and the
-- totals no longer added up to the activity's max marks.
--
-- refresh_criterion_marks brings one criterion's marks into line:
--   * a full mark stays full (3/3 -> 1/1, 1/1 -> n/n)
--   * any other mark keeps its value, capped one below the new full mark
--     (so anything short of full on a binary criterion is 0)
-- and rewrites the total of every submission it touched. The curriculum
-- builder runs it after changing a criterion's type or levels
-- (recalculateMaxMarksForCriterion), and the results page runs it for one
-- activity from "Refresh criteria".
--
-- Run once here for every criterion already out of step.

BEGIN;

-- Self-marking types keep their own totals (and their whole override): their
-- marks come from their rules, not their criteria.
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
              WHERE s.submission_id = p_submission_id AND is_self_marking_activity_type(a.type)) THEN
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

-- Returns the number of submissions whose marks changed.
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
    RETURNING m.submission_id
  )
  SELECT coalesce(array_agg(DISTINCT submission_id), '{}') INTO v_submissions FROM changed;

  FOREACH v_submission_id IN ARRAY v_submissions LOOP
    PERFORM refresh_submission_sc_total(v_submission_id);
  END LOOP;

  RETURN cardinality(v_submissions);
END $$;

-- Every criterion on one activity, then the totals of its pupils' work.
-- Returns the number of submissions whose marks changed.
CREATE OR REPLACE FUNCTION refresh_activity_criteria(p_activity_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_changed integer := 0;
  r record;
BEGIN
  FOR r IN SELECT success_criteria_id FROM activity_success_criteria WHERE activity_id = p_activity_id LOOP
    v_changed := v_changed + refresh_criterion_marks(r.success_criteria_id);
  END LOOP;

  FOR r IN
    SELECT DISTINCT m.submission_id
      FROM submission_sc_marks m
      JOIN submissions s ON s.submission_id = m.submission_id
     WHERE s.activity_id = p_activity_id
  LOOP
    PERFORM refresh_submission_sc_total(r.submission_id);
  END LOOP;

  RETURN v_changed;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT m.success_criteria_id
      FROM submission_sc_marks m
     WHERE m.available <> sc_available_marks(m.success_criteria_id)
  LOOP
    PERFORM refresh_criterion_marks(r.success_criteria_id);
  END LOOP;
END $$;

COMMIT;
