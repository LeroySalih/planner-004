-- 098-rescale-submission-marks-function.sql
--
-- The rule migration 097 applied as a one-off repair, as a function, so that
-- derive-max-marks.ts can apply it every time it moves an activity's max_marks.
--
-- submissions.body holds marks two ways: scale-free fractions and absolute
-- marks that only mean anything against activities.max_marks. max_marks is
-- derived from the success criteria, so a criterion edit silently rewrites the
-- score of work that was already marked unless the absolute fields move with
-- it. 097 measured the damage: 965 rows across three fields, and 514 pupil
-- scores reading an average of 35.7% where the teacher had given 90.3%.
--
-- CEIL and the clamp to [0, max_marks] match 077 and 097, so a row rescaled
-- here agrees with one written by the app.

CREATE OR REPLACE FUNCTION rescale_submission_marks(
  body jsonb,
  old_max numeric,
  new_max numeric
) RETURNS jsonb AS $$
DECLARE
  result jsonb := body;
  field text;
  value numeric;
BEGIN
  IF body IS NULL
     OR coalesce(old_max, 0) <= 0
     OR coalesce(new_max, 0) <= 0
     OR old_max = new_max THEN
    RETURN body;
  END IF;

  -- auto_marks and teacher_ai_marks carry no rows today but are in the
  -- priority chain in src/lib/scoring/submission-marks.ts, so they drift the
  -- moment anything starts writing them.
  FOREACH field IN ARRAY ARRAY[
    'marks_override', 'ai_marks', 'marks', 'auto_marks', 'teacher_ai_marks'
  ] LOOP
    IF result ? field AND result->>field ~ '^-?\d+(\.\d+)?$' THEN
      value := (result->>field)::numeric;
      result := jsonb_set(
        result,
        ARRAY[field],
        to_jsonb(least(new_max, greatest(0, ceil(value / old_max * new_max)))::int),
        true
      );
    END IF;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION rescale_submission_marks(jsonb, numeric, numeric) IS
  'Move every absolute mark in a submission body from one max_marks to another, preserving the fraction. Call whenever activities.max_marks changes.';
