CREATE OR REPLACE FUNCTION public.pupil_lessons_detail_bootstrap(p_target_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  -- Validate user exists
  if not exists (select 1 from profiles where user_id = p_target_user_id) then
    return jsonb_build_object(
      'pupilProfile', null,
      'memberships', '[]'::jsonb,
      'lessonAssignments', '[]'::jsonb,
      'units', '[]'::jsonb,
      'learningObjectives', '[]'::jsonb,
      'successCriteria', '[]'::jsonb,
      'successCriteriaUnits', '[]'::jsonb
    );
  end if;

  with target_memberships as (
    select
      gm.user_id,
      gm.group_id,
      lower(coalesce(ur.role_id, '')) as role,
      g.subject,
      coalesce(g.active, true) as group_active
    from group_membership gm
    join groups g on g.group_id = gm.group_id
    left join user_roles ur on ur.user_id = gm.user_id
    where lower(coalesce(ur.role_id, '')) = 'pupil'
      and gm.user_id = p_target_user_id
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
      coalesce(la.feedback_visible, false) as feedback_visible,
      coalesce(la.hidden, false) as hidden
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
      'successCriteriaUnits', '[]'::jsonb
    )
  );
end;
$$;

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
      coalesce(la.feedback_visible, false) as feedback_visible,
      coalesce(la.hidden, false) as hidden
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
