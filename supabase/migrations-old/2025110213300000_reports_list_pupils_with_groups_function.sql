-- Consolidated pupil/group listing for /reports
create or replace function public.reports_list_pupils_with_groups()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  result jsonb;
begin
  with pupil_rows as (
    select
      p.user_id as pupil_id,
      trim(coalesce(p.first_name, '')) as first_name,
      trim(coalesce(p.last_name, '')) as last_name
    from profiles p
    where coalesce(p.is_teacher, false) = false
      and p.user_id is not null
  ),
  aggregated as (
    select
      pr.pupil_id,
      nullif(trim(concat_ws(' ', nullif(pr.first_name, ''), nullif(pr.last_name, ''))), '') as pupil_name,
      coalesce(
        (
          select coalesce(jsonb_agg(group_payload order by group_sort, group_id), '[]'::jsonb)
          from (
            select
              gm.group_id,
              lower(coalesce(g.subject, gm.group_id)) as group_sort,
              jsonb_build_object(
                'group_id', gm.group_id,
                'group_name', g.subject
              ) as group_payload
            from group_membership gm
            left join groups g on g.group_id = gm.group_id
            where gm.user_id = pr.pupil_id
              and coalesce(lower(gm.role), '') = 'pupil'
              and gm.group_id is not null
            group by gm.group_id, g.subject
          ) membership_rows
        ),
        '[]'::jsonb
      ) as groups_json
    from pupil_rows pr
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pupilId', a.pupil_id,
        'pupilName', coalesce(a.pupil_name, a.pupil_id),
        'groups', a.groups_json
      )
      order by lower(coalesce(a.pupil_name, a.pupil_id)), a.pupil_id
    ),
    '[]'::jsonb
  )
  into result
  from aggregated a;

  return result;
end;
$function$;
