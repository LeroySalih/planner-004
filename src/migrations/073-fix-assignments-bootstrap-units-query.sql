-- Fix: units query was INNER JOINed to assignments, so only units already
-- assigned to the selected groups were returned. New assignments to any unit
-- were impossible unless it had been previously assigned to that exact group.
-- Fix: return all active units; subject-based filtering happens client-side.

create or replace function public.assignments_bootstrap_for_groups(p_group_ids text[])
returns jsonb
  language plpgsql security definer
  set search_path to 'public'
  as $$
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
          and group_id = any(p_group_ids)
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
          and group_id = any(p_group_ids)
      ) as row_data
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.title, row_data.unit_id)
      from (
        select u.unit_id, u.title, u.subject, u.description, u.year, coalesce(u.active, true) as active
        from units u
        where coalesce(u.active, true) = true
      ) as row_data
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.unit_id, row_data.order_by nulls first, row_data.title)
      from (
        select distinct l.lesson_id, l.unit_id, l.title, coalesce(l.order_by, 0) as order_by, coalesce(l.active, true) as active
        from lessons l
        inner join units u on u.unit_id = l.unit_id
        inner join assignments a on a.unit_id = u.unit_id
        where coalesce(a.active, true) = true
          and a.group_id = any(p_group_ids)
      ) as row_data
    ), '[]'::jsonb),
    'lessonAssignments', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.group_id, row_data.lesson_id)
      from (
        select group_id, lesson_id, start_date,
          coalesce(hidden, false) as hidden,
          coalesce(locked, false) as locked,
          coalesce(feedback_visible, false) as feedback_visible
        from lesson_assignments
        where group_id = any(p_group_ids)
      ) as row_data
    ), '[]'::jsonb)
  );

  return result;
end;
$$;
