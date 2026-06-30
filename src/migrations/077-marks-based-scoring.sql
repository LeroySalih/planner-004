-- src/migrations/077-marks-based-scoring.sql
-- Adds whole-number marks-based scoring alongside the existing fraction-based
-- scoring (which remains for rollback safety but is no longer used by the app).

-- 1. Add max_marks to activities, defaulting to 1, with short-text-question at 3.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_marks INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activities ADD CONSTRAINT activities_max_marks_positive CHECK (max_marks > 0);

UPDATE activities SET max_marks = 3 WHERE type = 'short-text-question' AND max_marks = 1;

-- 2. clamp_marks: clamps an integer to [0, max_marks], NULL passthrough.
CREATE OR REPLACE FUNCTION clamp_marks(value INTEGER, max_marks INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;
  IF value < 0 THEN
    RETURN 0;
  END IF;
  IF value > max_marks THEN
    RETURN max_marks;
  END IF;
  RETURN value;
END;
$$;

-- 3. compute_submission_marks: marks-based counterpart to compute_submission_base_score.
-- Priority: marks_override -> MCQ is_correct (scaled to max_marks) -> STQ teacher_ai_marks/ai_marks/marks/auto_marks
-- -> generic marks/auto_marks. Returns NULL if nothing found (unmarked).
CREATE OR REPLACE FUNCTION compute_submission_marks(body JSONB, activity_type TEXT, max_marks INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  override_val INTEGER;
  is_correct_val BOOLEAN;
  result INTEGER;
BEGIN
  IF body IS NULL THEN
    RETURN NULL;
  END IF;

  override_val := (body->>'marks_override')::INTEGER;
  IF override_val IS NOT NULL THEN
    RETURN clamp_marks(override_val, max_marks);
  END IF;

  IF activity_type IN ('multiple-choice-question', 'matcher') THEN
    is_correct_val := (body->>'is_correct')::BOOLEAN;
    IF is_correct_val IS NOT NULL THEN
      RETURN CASE WHEN is_correct_val THEN max_marks ELSE 0 END;
    END IF;
    result := COALESCE((body->>'marks')::INTEGER, (body->>'auto_marks')::INTEGER);
    RETURN clamp_marks(result, max_marks);
  END IF;

  IF activity_type = 'short-text-question' THEN
    result := COALESCE(
      (body->>'teacher_ai_marks')::INTEGER,
      (body->>'ai_marks')::INTEGER,
      (body->>'marks')::INTEGER,
      (body->>'auto_marks')::INTEGER
    );
    RETURN clamp_marks(result, max_marks);
  END IF;

  result := COALESCE((body->>'marks')::INTEGER, (body->>'auto_marks')::INTEGER);
  RETURN clamp_marks(result, max_marks);
END;
$$;

-- 4. Backfill: write marks/marks_override into every existing submissions.body row,
-- derived from the existing fraction-based score, using each activity's max_marks.
-- ceil(fraction * max_marks); unmarked (NULL base score) stays NULL.
WITH activity_max AS (
  SELECT activity_id, type, max_marks FROM activities
)
UPDATE submissions s
SET body = (
  CASE
    WHEN compute_submission_base_score(s.body, am.type) IS NULL THEN s.body::jsonb
    ELSE jsonb_set(
      s.body::jsonb,
      '{marks}',
      to_jsonb(CEIL(compute_submission_base_score(s.body, am.type) * am.max_marks)::INTEGER),
      true
    )
  END
)::json
FROM activity_max am
WHERE s.activity_id = am.activity_id;

-- Carry forward any existing teacher_override_score into marks_override.
WITH activity_max AS (
  SELECT activity_id, max_marks FROM activities
)
UPDATE submissions s
SET body = jsonb_set(
  s.body::jsonb,
  '{marks_override}',
  to_jsonb(CEIL(((s.body::jsonb->>'teacher_override_score')::numeric) * am.max_marks)::INTEGER),
  true
)::json
FROM activity_max am
WHERE s.activity_id = am.activity_id
  AND s.body::jsonb->>'teacher_override_score' IS NOT NULL;
