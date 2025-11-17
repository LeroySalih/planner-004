-- Create consolidated report dataset function
create or replace function public.reports_get_prepared_report_dataset(
  p_pupil_id text,
  p_group_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  result jsonb;
begin
  with relevant_groups as (
    select gm.group_id
    from group_membership gm
    where gm.user_id = p_pupil_id
      and (p_group_id is null or gm.group_id = p_group_id)
  ),
  membership_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_id', gm.group_id,
          'user_id', gm.user_id,
          'role', gm.role,
          'group', to_jsonb(g)
        )
      ),
      '[]'::jsonb
    ) as data
    from group_membership gm
    left join groups g on g.group_id = gm.group_id
    where gm.user_id = p_pupil_id
  ),
  profile_json as (
    select to_jsonb(p) as data
    from profiles p
    where p.user_id = p_pupil_id
  ),
  feedback_json as (
    select coalesce(
      jsonb_agg(to_jsonb(f) order by f.id),
      '[]'::jsonb
    ) as data
    from feedback f
    where f.user_id = p_pupil_id
  ),
  direct_assignments as (
    select jsonb_build_object(
      'group_id', a.group_id,
      'unit_id', a.unit_id,
      'start_date', a.start_date,
      'end_date', a.end_date,
      'active', coalesce(a.active, true),
      'unit', to_jsonb(u)
    ) as payload
    from assignments a
    left join units u on u.unit_id = a.unit_id
    where a.group_id in (select group_id from relevant_groups)
      and coalesce(a.active, true) = true
  ),
  lesson_assignments as (
    select jsonb_build_object(
      'group_id', la.group_id,
      'unit_id', l.unit_id,
      'start_date', coalesce(la.start_date::timestamptz, now()),
      'end_date', coalesce(la.start_date::timestamptz, now()),
      'active', true,
      'unit', to_jsonb(u)
    ) as payload
    from lesson_assignments la
    join lessons l on l.lesson_id = la.lesson_id
    left join units u on u.unit_id = l.unit_id
    where la.group_id in (select group_id from relevant_groups)
      and l.unit_id is not null
  ),
  combined_assignments as (
    select payload from direct_assignments
    union all
    select payload from lesson_assignments
  ),
  assignments_json as (
    select coalesce(jsonb_agg(payload), '[]'::jsonb) as data
    from combined_assignments
  ),
  unit_ids as (
    select distinct payload->>'unit_id' as unit_id
    from combined_assignments
    where payload ? 'unit_id'
      and length(payload->>'unit_id') > 0
  ),
  units_json as (
    select coalesce(jsonb_agg(unit_payload), '[]'::jsonb) as data
    from (
      select jsonb_build_object(
        'unit_id', u.unit_id,
        'learning_objectives', (
          select coalesce(jsonb_agg(lo_payload), '[]'::jsonb)
          from (
            select jsonb_build_object(
              'learning_objective_id', lo.learning_objective_id,
              'assessment_objective_id', lo.assessment_objective_id,
              'spec_ref', lo.spec_ref,
              'title', lo.title,
              'order_index', lo.order_index,
              'active', coalesce(lo.active, true),
              'assessment_objective_code', ao.code,
              'assessment_objective_title', ao.title,
              'assessment_objective_order_index', ao.order_index,
              'assessment_objective_curriculum_id', ao.curriculum_id,
              'assessment_objective_unit_id', ao.unit_id,
              'success_criteria', (
                select coalesce(jsonb_agg(sc_payload), '[]'::jsonb)
                from (
                  select jsonb_build_object(
                    'success_criteria_id', sc.success_criteria_id,
                    'learning_objective_id', sc.learning_objective_id,
                    'level', sc.level,
                    'description', sc.description,
                    'order_index', sc.order_index,
                    'active', coalesce(sc.active, true)
                  ) as sc_payload
                  from success_criteria sc
                  join success_criteria_units scu on scu.success_criteria_id = sc.success_criteria_id
                  where sc.learning_objective_id = lo.learning_objective_id
                    and scu.unit_id = u.unit_id
                  order by coalesce(sc.order_index, 0), sc.success_criteria_id
                ) sc_rows
              )
            ) as lo_payload
            from learning_objectives lo
            left join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
            where exists (
              select 1
              from success_criteria sc2
              join success_criteria_units scu2 on scu2.success_criteria_id = sc2.success_criteria_id
              where sc2.learning_objective_id = lo.learning_objective_id
                and scu2.unit_id = u.unit_id
            )
            order by coalesce(lo.order_index, 0), lo.learning_objective_id
          ) lo_rows
        ),
        'lessons', (
          select coalesce(jsonb_agg(lesson_payload), '[]'::jsonb)
          from (
            select jsonb_build_object(
              'lesson_id', l.lesson_id,
              'unit_id', l.unit_id,
              'title', l.title,
              'order_by', l.order_by,
              'active', coalesce(l.active, true),
              'lesson_objectives', (
                select coalesce(jsonb_agg(lesson_lo_payload), '[]'::jsonb)
                from (
                  select jsonb_build_object(
                    'lesson_id', llo.lesson_id,
                    'learning_objective_id', llo.learning_objective_id,
                    'title', llo.title,
                    'order_by', llo.order_by,
                    'active', coalesce(llo.active, true),
                    'learning_objective', (
                      case when lo2.learning_objective_id is not null then
                        jsonb_build_object(
                          'learning_objective_id', lo2.learning_objective_id,
                          'assessment_objective_id', lo2.assessment_objective_id,
                          'title', lo2.title,
                          'order_index', lo2.order_index,
                          'active', coalesce(lo2.active, true),
                          'spec_ref', lo2.spec_ref,
                          'assessment_objective_title', ao2.title,
                          'assessment_objective_code', ao2.code,
                          'assessment_objective_order_index', ao2.order_index,
                          'assessment_objective_curriculum_id', ao2.curriculum_id,
                          'assessment_objective_unit_id', ao2.unit_id
                        )
                      else null end
                    )
                  ) as lesson_lo_payload
                  from lessons_learning_objective llo
                  left join learning_objectives lo2 on lo2.learning_objective_id = llo.learning_objective_id
                  left join assessment_objectives ao2 on ao2.assessment_objective_id = lo2.assessment_objective_id
                  where llo.lesson_id = l.lesson_id
                    and coalesce(llo.active, true) = true
                  order by coalesce(llo.order_by, 0), llo.learning_objective_id
                ) lesson_lo_rows
              ),
              'lesson_links', (
                select coalesce(jsonb_agg(link_payload), '[]'::jsonb)
                from (
                  select jsonb_build_object(
                    'lesson_link_id', ll.lesson_link_id,
                    'lesson_id', ll.lesson_id,
                    'url', ll.url,
                    'description', ll.description
                  ) as link_payload
                  from lesson_links ll
                  where ll.lesson_id = l.lesson_id
                  order by ll.lesson_link_id
                ) link_rows
              ),
              'lesson_success_criteria', (
                select coalesce(jsonb_agg(criterion_payload), '[]'::jsonb)
                from (
                  select jsonb_build_object(
                    'lesson_id', lsc.lesson_id,
                    'success_criteria_id', lsc.success_criteria_id,
                    'title', coalesce(sc.description, 'Success criterion'),
                    'description', sc.description,
                    'level', sc.level,
                    'learning_objective_id', sc.learning_objective_id,
                    'activity_id', asc_map.activity_id
                  ) as criterion_payload
                  from lesson_success_criteria lsc
                  left join success_criteria sc on sc.success_criteria_id = lsc.success_criteria_id
                  left join lateral (
                    select asc_link.activity_id
                    from activity_success_criteria asc_link
                    join activities act on act.activity_id = asc_link.activity_id
                    where asc_link.success_criteria_id = lsc.success_criteria_id
                      and act.lesson_id = l.lesson_id
                    order by act.order_by nulls first, act.activity_id
                    limit 1
                  ) asc_map on true
                  where lsc.lesson_id = l.lesson_id
                  order by coalesce(sc.level, 0), lsc.success_criteria_id
                ) criterion_rows
              ),
              'activities', (
                select coalesce(jsonb_agg(activity_payload), '[]'::jsonb)
                from (
                  select jsonb_build_object(
                    'activity_id', a.activity_id,
                    'lesson_id', a.lesson_id,
                    'title', a.title,
                    'type', a.type,
                    'body_data', a.body_data,
                    'is_homework', coalesce(a.is_homework, false),
                    'is_summative', coalesce(a.is_summative, false),
                    'order_by', a.order_by,
                    'active', coalesce(a.active, true),
                    'success_criteria_ids', (
                      select coalesce(jsonb_agg(asc_link.success_criteria_id), '[]'::jsonb)
                      from activity_success_criteria asc_link
                      where asc_link.activity_id = a.activity_id
                    )
                  ) as activity_payload
                  from activities a
                  where a.lesson_id = l.lesson_id
                  order by coalesce(a.order_by, 0), a.activity_id
                ) activity_rows
              ),
              'submissions', (
                select coalesce(jsonb_agg(submission_payload), '[]'::jsonb)
                from (
                  select jsonb_build_object(
                    'submission_id', s.submission_id,
                    'activity_id', s.activity_id,
                    'user_id', s.user_id,
                    'submitted_at', s.submitted_at,
                    'body', s.body
                  ) as submission_payload
                  from submissions s
                  where s.activity_id in (
                    select a.activity_id
                    from activities a
                    where a.lesson_id = l.lesson_id
                  )
                  order by s.submitted_at desc, s.submission_id
                ) submission_rows
              )
            ) as lesson_payload
            from lessons l
            where l.unit_id = u.unit_id
            order by coalesce(l.order_by, 0), l.lesson_id
          ) lesson_rows
        )
      ) as unit_payload
      from units u
      where u.unit_id in (select unit_id from unit_ids)
      order by u.unit_id
    ) unit_rows
  )
  select jsonb_build_object(
    'profile', (select data from profile_json),
    'memberships', (select data from membership_json),
    'assignments', (select data from assignments_json),
    'feedback', (select data from feedback_json),
    'units', (select data from units_json)
  )
  into result;

  if result is null then
    result := jsonb_build_object(
      'profile', null,
      'memberships', '[]'::jsonb,
      'assignments', '[]'::jsonb,
      'feedback', '[]'::jsonb,
      'units', '[]'::jsonb
    );
  end if;

  return result;
end;
$function$;

grant execute on function public.reports_get_prepared_report_dataset(text, text) to authenticated, service_role;
