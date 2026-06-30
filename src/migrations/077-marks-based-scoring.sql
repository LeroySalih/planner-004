-- src/migrations/077-marks-based-scoring.sql
-- Adds whole-number marks-based scoring alongside the existing fraction-based
-- scoring (which remains for rollback safety but is no longer used by the app).

-- 1. Add max_marks to activities, defaulting to 1, with short-text-question at 3.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_marks INTEGER NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activities_max_marks_positive'
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_max_marks_positive CHECK (max_marks > 0);
  END IF;
END;
$$;

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
-- NOTE: submissions.body is declared `json`, not `jsonb` — callers must cast body::jsonb when invoking this function.
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

-- Task 2: rewrite lesson_assignment_score_summaries for marks-based aggregation
-- Drop-in replacement: same signature (pairs jsonb -> group_id, lesson_id, activities_average),
-- but scoring is now marks-based (compute_submission_marks / activities.max_marks) instead of
-- compute_submission_base_score + per-success-criterion sub-averaging. activities_average remains
-- a 0-1 fraction (clamp_score-wrapped) to preserve the existing Zod contract
-- (LessonAssignmentScoreSummariesSchema: activities_average z.number().min(0).max(1).nullable()).
CREATE OR REPLACE FUNCTION public.lesson_assignment_score_summaries(pairs jsonb) RETURNS TABLE(group_id text, lesson_id text, activities_average numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with dedup_pairs as (
    select distinct
      pair->>'groupId' as group_id,
      pair->>'lessonId' as lesson_id
    from jsonb_array_elements(coalesce(pairs, '[]'::jsonb)) as pair
    where coalesce(pair->>'groupId', '') <> ''
      and coalesce(pair->>'lessonId', '') <> ''
  ),
  pupils as (
    select distinct gm.group_id, gm.user_id
    from group_membership gm
    join dedup_pairs dp on dp.group_id = gm.group_id
    where gm.user_id is not null
  ),
  scorable_activities as (
    select distinct
      a.activity_id,
      a.lesson_id,
      lower(trim(coalesce(a.type, ''))) as activity_type,
      a.max_marks
    from activities a
    join dedup_pairs dp on dp.lesson_id = a.lesson_id
    where coalesce(a.active, true) = true
      and lower(trim(coalesce(a.type, ''))) = any (array[
        'multiple-choice-question', 'short-text-question', 'text-question',
        'long-text-question', 'upload-file', 'upload-url', 'upload-spreadsheet',
        'upload-worksheet', 'feedback', 'sketch-render', 'do-flashcards',
        'matcher', 'group-items'
      ])
  ),
  pair_activity_pupil as (
    select
      dp.group_id,
      dp.lesson_id,
      act.activity_id,
      act.activity_type,
      act.max_marks,
      pup.user_id
    from dedup_pairs dp
    join scorable_activities act on act.lesson_id = dp.lesson_id
    join pupils pup on pup.group_id = dp.group_id
  ),
  submission_candidates as (
    select
      pap.group_id,
      pap.lesson_id,
      pap.activity_id,
      pap.activity_type,
      pap.max_marks,
      pap.user_id,
      s.submission_id,
      s.body,
      s.submitted_at,
      row_number() over (
        partition by pap.activity_id, pap.user_id
        order by s.submitted_at desc nulls last, s.submission_id desc
      ) as rn
    from pair_activity_pupil pap
    left join submissions s on s.activity_id = pap.activity_id and s.user_id = pap.user_id
  ),
  latest_submissions as (
    select *
    from submission_candidates
    where rn = 1
  ),
  submission_scores as (
    select
      ls.group_id,
      ls.lesson_id,
      coalesce(marks_score.score_value, 0)::numeric as score_value,
      case when ls.submission_id is not null then true else false end as has_submission
    from latest_submissions ls
    left join lateral (
      select
        case
          when ls.max_marks is null or ls.max_marks = 0 then null
          else compute_submission_marks(ls.body::jsonb, ls.activity_type, ls.max_marks)::numeric / ls.max_marks
        end as score_value
    ) as marks_score on true
  ),
  aggregated as (
    select
      ss.group_id,
      ss.lesson_id,
      sum(ss.score_value) as total_score,
      count(*) as cell_count,
      bool_or(ss.has_submission) as has_submission
    from submission_scores ss
    group by ss.group_id, ss.lesson_id
  )
  select
    dp.group_id,
    dp.lesson_id,
    case
      when agg.has_submission and agg.cell_count > 0 then clamp_score(agg.total_score / agg.cell_count)
      else null
    end as activities_average
  from dedup_pairs dp
  left join aggregated agg on agg.group_id = dp.group_id and agg.lesson_id = dp.lesson_id
  order by dp.group_id, dp.lesson_id;
end;
$$;
