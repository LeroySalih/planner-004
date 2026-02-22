ALTER TABLE lesson_assignments ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT FALSE;

-- Update pupil_lessons_summary_bootstrap to include the locked column
CREATE OR REPLACE FUNCTION pupil_lessons_summary_bootstrap(p_target_user_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
      coalesce(la.hidden, false) as hidden,
      coalesce(la.locked, false) as locked
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
