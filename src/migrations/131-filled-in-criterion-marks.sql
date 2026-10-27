-- 131-filled-in-criterion-marks.sql
--
-- AI re-marking keeps every criterion mark tagged 'teacher'. Marks DINO fills
-- in by itself were tagged 'teacher' too, so a re-mark could never correct
-- them: the 0s given to a pupil's other criteria when a teacher marks one, and
-- the marks carried over when criteria are linked to work already done
-- (migration 129's trigger).
--
-- Those are now tagged 'legacy': derived, not assessed. AI re-marking replaces
-- them, and a teacher marking one makes it 'teacher'. A teacher's own whole
-- mark of 0 or full (set_all_criteria_marks with p_replace) is still 'teacher'.

BEGIN;

CREATE OR REPLACE FUNCTION set_all_criteria_marks(p_submission_id text, p_full boolean, p_replace boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
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

COMMIT;
