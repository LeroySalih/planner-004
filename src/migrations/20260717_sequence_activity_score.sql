-- Include the new "sequence" activity type in the marks-based lesson averages.
-- Sequence submissions store integer `marks` in their body, so the generic
-- branch of compute_submission_marks already scores them; this migration only
-- adds 'sequence' to the scorable-type allowlist in lesson_assignment_score_summaries
-- (drop-in replacement of the function from 077-marks-based-scoring.sql).

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
        'matcher', 'group-items', 'voice', 'sequence'
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
