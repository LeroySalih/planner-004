-- Helper numeric parsing + scoring utilities for assignments RPCs
create or replace function public.safe_numeric(value text)
returns numeric
language plpgsql
immutable
as $function$
declare
  result numeric;
begin
  if value is null then
    return null;
  end if;
  begin
    result := value::numeric;
  exception when others then
    return null;
  end;
  return result;
end;
$function$;

create or replace function public.clamp_score(score numeric)
returns numeric
language sql
immutable
as $function$
  select case
    when score is null then null
    when score < 0 then 0::numeric
    when score > 1 then 1::numeric
    else score
  end;
$function$;

create or replace function public.compute_submission_base_score(body jsonb, activity_type text)
returns numeric
language plpgsql
stable
as $function$
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

  if normalized_type = 'multiple-choice-question' then
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
  elsif normalized_type = 'short-text-question' then
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
$function$;

create or replace function public.compute_submission_base_score(body json, activity_type text)
returns numeric
language sql
stable
as $function$
  select compute_submission_base_score(body::jsonb, activity_type);
$function$;

-- Aggregated payload for /assignments bootstrap
create or replace function public.assignments_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  result jsonb;
begin
  result := jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.group_id)
      from (
        select group_id, subject, join_code, coalesce(active, true) as active
        from groups
        where coalesce(active, true) = true
      ) as row_data
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.subject)
      from (
        select subject, coalesce(active, true) as active
        from subjects
        where coalesce(active, true) = true
      ) as row_data
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.group_id, row_data.unit_id, row_data.start_date)
      from (
        select group_id, unit_id, start_date, end_date, coalesce(active, true) as active
        from assignments
        where coalesce(active, true) = true
      ) as row_data
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.title, row_data.unit_id)
      from (
        select unit_id, title, subject, description, year, coalesce(active, true) as active
        from units
      ) as row_data
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.unit_id, row_data.order_by nulls first, row_data.title)
      from (
        select lesson_id, unit_id, title, coalesce(order_by, 0) as order_by, coalesce(active, true) as active
        from lessons
      ) as row_data
    ), '[]'::jsonb),
    'lessonAssignments', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.group_id, row_data.lesson_id)
      from (
        select group_id, lesson_id, start_date
        from lesson_assignments
      ) as row_data
    ), '[]'::jsonb)
  );

  return result;
end;
$function$;

-- Server-side score summaries for lesson assignments
create or replace function public.lesson_assignment_score_summaries(pairs jsonb)
returns table(group_id text, lesson_id text, activities_average numeric)
language plpgsql
security definer
set search_path = public
as $function$
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
    where lower(coalesce(gm.role, '')) = 'pupil'
      and gm.user_id is not null
  ),
  scorable_activities as (
    select distinct
      a.activity_id,
      a.lesson_id,
      lower(trim(coalesce(a.type, ''))) as activity_type
    from activities a
    join dedup_pairs dp on dp.lesson_id = a.lesson_id
    where coalesce(a.active, true) = true
      and lower(trim(coalesce(a.type, ''))) = any (array['multiple-choice-question', 'short-text-question', 'upload-file'])
  ),
  pair_activity_pupil as (
    select
      dp.group_id,
      dp.lesson_id,
      act.activity_id,
      act.activity_type,
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
      coalesce(sc_avg.avg_score, base_score.base_score, 0)::numeric as score_value,
      case when ls.submission_id is not null then true else false end as has_submission
    from latest_submissions ls
    left join lateral (
      select compute_submission_base_score(ls.body::jsonb, ls.activity_type) as base_score
    ) as base_score on true
    left join lateral (
      select avg(
        clamp_score(
          coalesce(
            safe_numeric(ls.body -> 'success_criteria_scores' ->> criteria.success_criteria_id),
            base_score.base_score
          )
        )
      ) as avg_score
      from activity_success_criteria criteria
      where criteria.activity_id = ls.activity_id
    ) as sc_avg on true
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
$function$;
