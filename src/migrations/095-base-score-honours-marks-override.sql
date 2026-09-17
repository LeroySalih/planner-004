-- 095-base-score-honours-marks-override.sql
--
-- compute_submission_base_score knew teacher_override_score and override_score
-- but not marks_override, which is what the assignment results panel actually
-- writes when a teacher sets a mark. 1413 submissions carry it, and to this
-- function every one of them looked unscored: the teacher dashboard counted
-- them as still needing marking, and dashboard_class_progress_summary averaged
-- them as zero.
--
-- The existing overrides are fractions; marks_override is in marks, so
-- converting it needs max_marks. Rather than change the two-argument signature
-- and every caller with it, this adds a three-argument form that takes
-- max_marks and falls back to the old behaviour when it is not supplied.
--
-- compute_submission_marks has honoured marks_override from the start, so the
-- progress reports were already correct. This closes the gap for the callers
-- that use the fraction form.

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_submission_base_score(
  body jsonb,
  activity_type text,
  max_marks integer
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $function$
declare
  marks_override_val numeric;
  safe_max integer := greatest(coalesce(max_marks, 1), 1);
begin
  if body is null then
    return null;
  end if;

  -- Marks, not a fraction: divide by the activity's ceiling before clamping.
  marks_override_val := safe_numeric(body->>'marks_override');
  if marks_override_val is not null then
    return clamp_score(marks_override_val / safe_max);
  end if;

  return compute_submission_base_score(body, activity_type);
end;
$function$;

COMMENT ON FUNCTION public.compute_submission_base_score(jsonb, text, integer) IS
  'Base score honouring marks_override, which is expressed in marks and so needs the activity max_marks. Falls back to the two-argument form for every other score field.';

CREATE OR REPLACE FUNCTION public.compute_submission_base_score(
  body json,
  activity_type text,
  max_marks integer
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  select compute_submission_base_score(body::jsonb, activity_type, max_marks);
$function$;

COMMIT;
