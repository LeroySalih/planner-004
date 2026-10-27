-- 129-criteria-marking.sql
--
-- Marking moves to success criteria across the app.
--
--   * Only an activity with success criteria counts towards progress. One
--     without criteria drops out of every figure, its marks and its max marks
--     alike, until a teacher links criteria to it. This applies to the
--     self-marking types too (multiple choice, matcher, flashcards, sequence,
--     group items): they keep marking themselves, the criteria decide whether
--     the activity counts.
--   * A teacher marks criterion by criterion. There is no whole-activity
--     override on an activity with criteria any more, so every existing one
--     on a pupil's latest attempt is converted to criterion marks here.
--   * When criteria are linked to an activity pupils have already done, a
--     whole mark of 0 or full converts to the same on every criterion and
--     anything in between becomes 0 (a trigger, so the app, MCP and the AI
--     chat are all covered).
--
-- Self-marking types are left out of the criterion conversion: their marks
-- come from their own rules and are capped at 1.

BEGIN;

-- Marks available on one criterion: binary 1, levelled one per descriptor.
-- Mirrors AVAILABLE_MARKS_SUBQUERY in src/lib/scoring/derive-max-marks.ts.
CREATE OR REPLACE FUNCTION sc_available_marks(p_success_criteria_id text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN sc.sc_type = 'levelled'
              THEN greatest(1, (SELECT count(*) FROM success_criteria_descriptors d
                                 WHERE d.success_criteria_id = sc.success_criteria_id))::int
              ELSE 1 END
    FROM success_criteria sc
   WHERE sc.success_criteria_id = p_success_criteria_id
$$;

-- Keep in step with DETERMINISTIC_ACTIVITY_TYPES in src/dino.config.ts.
CREATE OR REPLACE FUNCTION is_self_marking_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_type, ''))) = ANY (ARRAY[
    'multiple-choice-question', 'matcher', 'sequence', 'group-items', 'do-flashcards'
  ])
$$;

-- The progress rule: a scorable activity counts only with criteria linked.
-- Mirrored in TypeScript by countsForProgress (src/lib/scoring/counts-for-progress.ts).
CREATE OR REPLACE FUNCTION activity_counts_for_progress(p_activity_id text, p_type text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT is_scorable_activity_type(p_type)
     AND EXISTS (SELECT 1 FROM activity_success_criteria acs WHERE acs.activity_id = p_activity_id)
$$;

-- Rewrite a submission's cached total from its criterion marks, the way
-- recomputeSubmissionAggregate does after a teacher edit. Whole-activity
-- overrides are removed: with criteria, the total is their sum.
CREATE OR REPLACE FUNCTION refresh_submission_sc_total(p_submission_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_awarded integer;
  v_available integer;
  v_scores jsonb;
BEGIN
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

-- Give every criterion on the submission's activity the same mark: full, or
-- 0. p_replace overwrites marks already there (the conversion below); without
-- it only missing criteria are filled in.
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
           sc_available_marks(acs.success_criteria_id), 'teacher'
      FROM submissions s
      JOIN activity_success_criteria acs ON acs.activity_id = s.activity_id
     WHERE s.submission_id = p_submission_id
    ON CONFLICT (submission_id, success_criteria_id) DO NOTHING;
  END IF;

  PERFORM refresh_submission_sc_total(p_submission_id);
END $$;

-- Criteria linked to, or removed from, an activity pupils have already done.
--
-- Linked: each latest attempt with a mark keeps a full mark (the new criterion
-- is full) and anything less gets 0 for it, so a 0 or full whole mark converts
-- cleanly and a part mark becomes 0. Read against max_marks before it is
-- re-derived, which the app does after the link is saved.
-- Removed: the cached total is rewritten without that criterion.
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

  IF v_type IS NULL OR is_self_marking_activity_type(v_type) OR NOT is_scorable_activity_type(v_type) THEN
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

DROP TRIGGER IF EXISTS activity_success_criteria_marks ON activity_success_criteria;
CREATE TRIGGER activity_success_criteria_marks
  AFTER INSERT OR DELETE ON activity_success_criteria
  FOR EACH ROW EXECUTE FUNCTION activity_success_criteria_marks_on_change();

-- Convert the whole-activity overrides on pupils' latest attempts.
--   0 or full                         -> every criterion 0 or full
--   criterion marks already add up    -> kept, override dropped
--   part mark, last year's classes    -> every criterion full (no longer used)
--   part mark, otherwise              -> every criterion 0
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    WITH latest AS (
      SELECT DISTINCT ON (s.activity_id, s.user_id) s.submission_id, s.activity_id, s.user_id, s.body
        FROM submissions s
       ORDER BY s.activity_id, s.user_id, s.attempt_number DESC, s.submitted_at DESC NULLS LAST, s.submission_id DESC
    )
    SELECT l.submission_id,
           (l.body::jsonb ->> 'marks_override')::int AS override_marks,
           coalesce(a.max_marks, 1) AS max_marks,
           (SELECT count(*) FROM activity_success_criteria acs WHERE acs.activity_id = a.activity_id) AS criteria,
           (SELECT count(*) FROM submission_sc_marks m
              JOIN activity_success_criteria acs
                ON acs.activity_id = a.activity_id AND acs.success_criteria_id = m.success_criteria_id
             WHERE m.submission_id = l.submission_id) AS marked,
           (SELECT coalesce(sum(m.awarded), 0) FROM submission_sc_marks m
              JOIN activity_success_criteria acs
                ON acs.activity_id = a.activity_id AND acs.success_criteria_id = m.success_criteria_id
             WHERE m.submission_id = l.submission_id) AS marked_sum,
           EXISTS (SELECT 1 FROM lesson_assignments la
                     JOIN group_membership gm ON gm.group_id = la.group_id AND gm.user_id = l.user_id
                    WHERE la.lesson_id = a.lesson_id AND la.group_id LIKE '25-%')
             AND NOT EXISTS (SELECT 1 FROM lesson_assignments la
                     JOIN group_membership gm ON gm.group_id = la.group_id AND gm.user_id = l.user_id
                    WHERE la.lesson_id = a.lesson_id AND la.group_id NOT LIKE '25-%') AS last_year
      FROM latest l
      JOIN activities a ON a.activity_id = l.activity_id
     WHERE l.body::jsonb ->> 'marks_override' ~ '^\d+$'
       AND is_scorable_activity_type(a.type)
       AND NOT is_self_marking_activity_type(a.type)
       AND EXISTS (SELECT 1 FROM activity_success_criteria acs WHERE acs.activity_id = a.activity_id)
  LOOP
    IF r.override_marks <= 0 THEN
      PERFORM set_all_criteria_marks(r.submission_id, false, true);
    ELSIF r.override_marks >= r.max_marks THEN
      PERFORM set_all_criteria_marks(r.submission_id, true, true);
    ELSIF r.marked = r.criteria AND r.marked_sum = r.override_marks THEN
      PERFORM refresh_submission_sc_total(r.submission_id);
    ELSE
      PERFORM set_all_criteria_marks(r.submission_id, r.last_year, true);
    END IF;
  END LOOP;
END $$;

-- The progress baseline (migration 117) with the criteria rule.
CREATE OR REPLACE VIEW pupil_activity_scores AS
WITH pupils AS MATERIALIZED (
  -- Resolved once: a role predicate inside the main join flips the planner
  -- onto a far slower plan (see resolvePupilIds).
  SELECT ur.user_id FROM user_roles ur WHERE lower(ur.role_id) = 'pupil'
  EXCEPT
  SELECT ur.user_id FROM user_roles ur WHERE lower(ur.role_id) IN ('teacher', 'admin', 'technician')
)
SELECT
  la.group_id,
  gm.user_id AS pupil_id,
  l.unit_id,
  l.lesson_id,
  a.activity_id,
  a.type AS activity_type,
  coalesce(a.is_summative, false) AS is_summative,
  coalesce(a.max_marks, 1) AS max_marks,
  latest.submission_id,
  coalesce(latest.marks, 0) AS marks,
  latest.criterion_scores,
  latest.criterion_marks,
  la.start_date
FROM lesson_assignments la
JOIN lessons l ON l.lesson_id = la.lesson_id AND l.active IS NOT FALSE
JOIN activities a ON a.lesson_id = l.lesson_id AND a.active IS NOT FALSE
                 AND activity_counts_for_progress(a.activity_id, a.type)
JOIN group_membership gm ON gm.group_id = la.group_id
JOIN pupils p ON p.user_id = gm.user_id
LEFT JOIN LATERAL (
  SELECT s.submission_id,
         compute_submission_marks(s.body::jsonb, a.type, coalesce(a.max_marks, 1)) AS marks,
         s.body::jsonb -> 'success_criteria_scores' AS criterion_scores,
         (SELECT jsonb_object_agg(scm.success_criteria_id, scm.awarded::numeric / nullif(scm.available, 0))
            FROM submission_sc_marks scm
           WHERE scm.submission_id = s.submission_id) AS criterion_marks
    FROM submissions s
   WHERE s.activity_id = a.activity_id AND s.user_id = gm.user_id
   ORDER BY s.attempt_number DESC, s.submitted_at DESC NULLS LAST, s.submission_id DESC
   LIMIT 1
) latest ON true
WHERE la.start_date <= current_date;

COMMENT ON VIEW pupil_activity_scores IS
  'Progress baseline: pupil x scorable activity with success criteria in started class lessons; latest-attempt marks, missing = 0. Average as sum(marks)/sum(max_marks).';

COMMIT;
