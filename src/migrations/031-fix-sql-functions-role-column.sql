-- Fix SQL functions after removing group_membership.role column

-- 1. lesson_assignment_score_summaries
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
$$;

-- 2. pupil_lessons_detail_bootstrap
CREATE OR REPLACE FUNCTION public.pupil_lessons_detail_bootstrap(p_target_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  if coalesce(p_target_user_id, '') = '' then
    return jsonb_build_object(
      'pupilProfile', null,
      'memberships', '[]'::jsonb,
      'lessonAssignments', '[]'::jsonb,
      'units', '[]'::jsonb,
      'learningObjectives', '[]'::jsonb,
      'successCriteria', '[]'::jsonb,
      'successCriteriaUnits', '[]'::jsonb,
      'homeworkActivities', '[]'::jsonb
    );
  end if;

  with target_memberships as (
    select
      gm.user_id,
      gm.group_id,
      'member' as role,
      g.subject,
      coalesce(g.active, true) as group_active
    from group_membership gm
    join groups g on g.group_id = gm.group_id
    where gm.user_id = p_target_user_id
      and coalesce(g.active, true) = true
  ),
  target_assignments as (
    select
      tm.user_id,
      la.group_id,
      la.lesson_id,
      la.start_date,
      tm.subject,
      l.title as lesson_title,
      l.unit_id,
      coalesce(la.feedback_visible, false) as feedback_visible
    from target_memberships tm
    join lesson_assignments la on la.group_id = tm.group_id
    join lessons l on l.lesson_id = la.lesson_id
  ),
  lesson_ids as (
    select distinct lesson_id from target_assignments
  ),
  unit_ids as (
    select distinct unit_id from target_assignments where unit_id is not null
  ),
  unit_rows as (
    select
      u.unit_id,
      u.title,
      u.subject,
      u.description,
      u.year
    from units u
    join unit_ids ui on ui.unit_id = u.unit_id
  ),
  learning_objective_rows as (
    select distinct
      lo.learning_objective_id,
      lo.assessment_objective_id,
      lo.title,
      lo.order_index,
      lo.active,
      lo.spec_ref,
      ao.code as assessment_objective_code,
      ao.title as assessment_objective_title,
      ao.order_index as assessment_objective_order_index,
      ao.curriculum_id as assessment_objective_curriculum_id,
      ao.unit_id as assessment_objective_unit_id
    from learning_objectives lo
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    join lessons_learning_objective llo on llo.learning_objective_id = lo.learning_objective_id
    join lesson_ids li on li.lesson_id = llo.lesson_id
  ),
  success_criteria_rows as (
    select
      sc.success_criteria_id,
      sc.learning_objective_id,
      sc.level,
      sc.description,
      sc.order_index,
      sc.active
    from success_criteria sc
    where sc.learning_objective_id in (select learning_objective_id from learning_objective_rows)
  ),
  success_criteria_units_rows as (
    select
      scu.success_criteria_id,
      scu.unit_id
    from success_criteria_units scu
    where scu.success_criteria_id in (select success_criteria_id from success_criteria_rows)
      and scu.unit_id in (select unit_id from unit_ids)
  ),
  homework_rows as (
    select
      act.activity_id,
      act.lesson_id,
      act.title,
      act.type,
      act.order_by
    from activities act
    where coalesce(act.is_homework, false) = true
      and coalesce(act.active, true) = true
      and act.lesson_id in (select lesson_id from lesson_ids)
  )
  select jsonb_build_object(
    'pupilProfile', (
      select row_to_json(pr)
      from (
        select
          pr.user_id,
          pr.first_name,
          pr.last_name,
          pr.is_teacher
        from profiles pr
        where pr.user_id = p_target_user_id
        limit 1
      ) pr
    ),
    'memberships', coalesce(
      (select jsonb_agg(row_to_json(tm) order by tm.group_id) from target_memberships tm),
      '[]'::jsonb
    ),
    'lessonAssignments', coalesce(
      (select jsonb_agg(row_to_json(ta) order by ta.group_id, ta.lesson_id, ta.start_date) from target_assignments ta),
      '[]'::jsonb
    ),
    'units', coalesce(
      (select jsonb_agg(row_to_json(u) order by u.title, u.unit_id) from unit_rows u),
      '[]'::jsonb
    ),
    'learningObjectives', coalesce(
      (select jsonb_agg(row_to_json(lo) order by lo.order_index, lo.learning_objective_id) from learning_objective_rows lo),
      '[]'::jsonb
    ),
    'successCriteria', coalesce(
      (select jsonb_agg(row_to_json(sc) order by sc.order_index, sc.level, sc.success_criteria_id) from success_criteria_rows sc),
      '[]'::jsonb
    ),
    'successCriteriaUnits', coalesce(
      (select jsonb_agg(row_to_json(scu) order by scu.success_criteria_id, scu.unit_id) from success_criteria_units_rows scu),
      '[]'::jsonb
    ),
    'homeworkActivities', coalesce(
      (select jsonb_agg(row_to_json(hr) order by hr.lesson_id, hr.order_by nulls first, hr.activity_id) from homework_rows hr),
      '[]'::jsonb
    )
  )
  into result;

  return coalesce(
    result,
    jsonb_build_object(
      'pupilProfile', null,
      'memberships', '[]'::jsonb,
      'lessonAssignments', '[]'::jsonb,
      'units', '[]'::jsonb,
      'learningObjectives', '[]'::jsonb,
      'successCriteria', '[]'::jsonb,
      'successCriteriaUnits', '[]'::jsonb,
      'homeworkActivities', '[]'::jsonb
    )
  );
end;
$$;

-- 3. pupil_lessons_summary_bootstrap
CREATE OR REPLACE FUNCTION public.pupil_lessons_summary_bootstrap(p_target_user_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  with target_pupils as (
    select distinct gm.user_id
    from group_membership gm
    where (p_target_user_id is null or gm.user_id = p_target_user_id)
  ),
  pupil_rows as (
    select
      tp.user_id,
      coalesce(nullif(trim(concat(pr.first_name, ' ', pr.last_name)), ''), tp.user_id) as display_name,
      pr.first_name,
      pr.last_name
    from target_pupils tp
    left join profiles pr on pr.user_id = tp.user_id
  ),
  membership_rows as (
    select
      gm.user_id,
      gm.group_id,
      'member' as role,
      g.subject,
      coalesce(g.active, true) as group_active
    from group_membership gm
    join groups g on g.group_id = gm.group_id
    where coalesce(g.active, true) = true
      and exists (select 1 from target_pupils tp where tp.user_id = gm.user_id)
  ),
  assignment_rows as (
    select
      la.group_id,
      la.lesson_id,
      la.start_date,
      l.title as lesson_title,
      l.unit_id,
      g.subject,
      coalesce(la.feedback_visible, false) as feedback_visible
    from lesson_assignments la
    join lessons l on l.lesson_id = la.lesson_id
    left join groups g on g.group_id = la.group_id
    where exists (
      select 1
      from membership_rows mr
      where mr.group_id = la.group_id
    )
  )
  select jsonb_build_object(
    'pupils', coalesce(
      (select jsonb_agg(row_to_json(pr) order by pr.display_name, pr.user_id) from pupil_rows pr),
      '[]'::jsonb
    ),
    'memberships', coalesce(
      (select jsonb_agg(row_to_json(mr) order by mr.user_id, mr.group_id) from membership_rows mr),
      '[]'::jsonb
    ),
    'lessonAssignments', coalesce(
      (select jsonb_agg(row_to_json(ar) order by ar.group_id, ar.lesson_id, ar.start_date) from assignment_rows ar),
      '[]'::jsonb
    )
  )
  into result;

  return coalesce(
    result,
    jsonb_build_object(
      'pupils', '[]'::jsonb,
      'memberships', '[]'::jsonb,
      'lessonAssignments', '[]'::jsonb
    )
  );
end;
$$;

-- 4. reports_get_prepared_report_dataset
CREATE OR REPLACE FUNCTION public.reports_get_prepared_report_dataset(p_pupil_id text, p_group_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
          'role', 'member',
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
$$;

-- 5. reports_list_pupils_with_groups
CREATE OR REPLACE FUNCTION public.reports_list_pupils_with_groups() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  with pupil_rows as (
    select
      p.user_id as pupil_id,
      trim(coalesce(p.first_name, '')) as first_name,
      trim(coalesce(p.last_name, '')) as last_name
    from profiles p
    where p.user_id is not null
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
$$;
