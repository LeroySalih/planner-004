-- 101-matcher-partial-credit.sql
--
-- Matching questions were marked all or nothing: seven pairs right out of
-- eight scored zero. They now earn one mark per correctly matched pair, so a
-- matcher's max_marks is its pair count rather than the 1 every deterministic
-- type was capped at.
--
-- Three parts:
--   1. compute_submission_marks reads a matcher's stored marks instead of
--      turning is_correct into full marks or none.
--   2. compute_submission_base_score reads its stored fraction, for the same
--      reason. is_correct stays as the fallback for anything not yet rescored.
--   3. recompute_matcher_submission_marks() rescores an activity's submissions
--      from the answers they already hold, and the backfill at the end applies
--      it to every matcher. src/lib/scoring/derive-max-marks.ts calls the same
--      function whenever a teacher edits the pairs.

BEGIN;

-- 1. Marks: prefer what was recorded, fall back to the old all-or-nothing rule.
CREATE OR REPLACE FUNCTION compute_submission_marks(body jsonb, activity_type text, max_marks integer)
RETURNS INTEGER AS $$
DECLARE
  override_val INTEGER;
  is_correct_val BOOLEAN;
  result INTEGER;
BEGIN
  IF body IS NULL THEN
    RETURN NULL;
  END IF;

  override_val := CASE WHEN body->>'marks_override' ~ '^-?\d+$' THEN (body->>'marks_override')::INTEGER END;
  IF override_val IS NOT NULL THEN
    RETURN clamp_marks(override_val, max_marks);
  END IF;

  IF activity_type = 'matcher' THEN
    result := COALESCE((body->>'marks')::INTEGER, (body->>'auto_marks')::INTEGER);
    IF result IS NOT NULL THEN
      RETURN clamp_marks(result, max_marks);
    END IF;
    is_correct_val := (body->>'is_correct')::BOOLEAN;
    IF is_correct_val IS NOT NULL THEN
      RETURN CASE WHEN is_correct_val THEN max_marks ELSE 0 END;
    END IF;
    RETURN NULL;
  END IF;

  IF activity_type = 'multiple-choice-question' THEN
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
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Base score: a matcher's fraction, not its is_correct flag.
CREATE OR REPLACE FUNCTION compute_submission_base_score(body jsonb, activity_type text)
RETURNS numeric AS $$
declare
  override numeric;
  auto_score numeric;
  normalized_type text := lower(coalesce(activity_type, ''));
  bool_value boolean;
begin
  if body is null then
    return null;
  end if;

  override := safe_numeric(
    coalesce(body->>'teacher_override_score', body->>'override_score')
  );

  if override is not null then
    return clamp_score(override);
  end if;

  if normalized_type = 'matcher' then
    auto_score := safe_numeric(coalesce(body->>'score', body->>'auto_score'));
    if auto_score is null then
      begin
        bool_value := (body->>'is_correct')::boolean;
      exception when others then
        bool_value := null;
      end;
      if bool_value is not null then
        auto_score := case when bool_value then 1 else 0 end;
      end if;
    end if;
  elsif normalized_type = 'multiple-choice-question' then
    begin
      bool_value := (body->>'is_correct')::boolean;
    exception when others then
      bool_value := null;
    end;

    if bool_value is not null then
      auto_score := case when bool_value then 1 else 0 end;
    else
      auto_score := safe_numeric(coalesce(body->>'score', body->>'auto_score'));
    end if;
  elsif normalized_type = 'short-text-question'
     or normalized_type = 'upload-spreadsheet'
     or normalized_type = 'upload-worksheet'
     or normalized_type = 'mark-worksheet'
     or normalized_type = 'upload-code' then
    auto_score := safe_numeric(
      coalesce(body->>'teacher_ai_score', body->>'ai_model_score', body->>'score', body->>'auto_score')
    );
  else
    auto_score := safe_numeric(coalesce(body->>'score', body->>'auto_score'));
  end if;

  if auto_score is not null then
    return clamp_score(auto_score);
  end if;

  return null;
end;
$$ LANGUAGE plpgsql STABLE;

-- 3. Rescore one matcher's submissions from the answers they already hold.
-- Counts an answer correct when it points at its own pair, which is how the
-- app records a match.
CREATE OR REPLACE FUNCTION recompute_matcher_submission_marks(p_activity_id text)
RETURNS integer AS $$
DECLARE
  pair_count integer;
  touched integer;
BEGIN
  SELECT jsonb_array_length(a.body_data::jsonb->'pairs')
  INTO pair_count
  FROM activities a
  WHERE a.activity_id = p_activity_id AND a.type = 'matcher';

  IF pair_count IS NULL OR pair_count = 0 THEN
    RETURN 0;
  END IF;

  WITH scored AS (
    SELECT s.submission_id,
           (
             SELECT count(*)
             FROM jsonb_each_text(s.body::jsonb->'answers') kv
             WHERE kv.value = kv.key
           )::int AS awarded
    FROM submissions s
    WHERE s.activity_id = p_activity_id
      AND s.body::jsonb ? 'answers'
  )
  UPDATE submissions s
  SET body = jsonb_set(
        jsonb_set(
          jsonb_set(s.body::jsonb, '{marks}', to_jsonb(scored.awarded), true),
          '{score}', to_jsonb(round(scored.awarded::numeric / pair_count, 6)), true
        ),
        '{is_correct}', to_jsonb(scored.awarded = pair_count), true
      )::json
  FROM scored
  WHERE s.submission_id = scored.submission_id;

  GET DIAGNOSTICS touched = ROW_COUNT;

  -- Criterion marks follow the same fraction. Teacher marks are never touched.
  UPDATE submission_sc_marks m
  SET awarded = round(
        (
          SELECT count(*) FROM jsonb_each_text(s.body::jsonb->'answers') kv WHERE kv.value = kv.key
        )::numeric / pair_count * m.available
      )::int
  FROM submissions s
  WHERE s.submission_id = m.submission_id
    AND s.activity_id = p_activity_id
    AND s.body::jsonb ? 'answers'
    AND m.provenance <> 'teacher';

  RETURN touched;
END;
$$ LANGUAGE plpgsql;

-- Backfill: max_marks becomes the pair count, then every submission rescores.
UPDATE activities a
SET max_marks = greatest(1, jsonb_array_length(a.body_data::jsonb->'pairs'))
WHERE a.type = 'matcher'
  AND a.body_data::jsonb ? 'pairs'
  AND a.max_marks IS DISTINCT FROM greatest(1, jsonb_array_length(a.body_data::jsonb->'pairs'));

SELECT recompute_matcher_submission_marks(a.activity_id)
FROM activities a
WHERE a.type = 'matcher' AND a.body_data::jsonb ? 'pairs';

COMMIT;
