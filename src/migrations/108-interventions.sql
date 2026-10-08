-- 108-interventions.sql
--
-- Intervention lessons: a lesson written for one pupil and assigned to that
-- pupil alone. It is an ordinary lesson underneath, so activities, marking,
-- success criteria and scoring all work unchanged; lessons.kind marks it so
-- every class-facing list can leave it out.
--
-- An intervention lesson stays in the unit whose material it covers, which
-- keeps the unit-curriculum guard and LO/SC links working as they do for any
-- other lesson.
--
-- Progress is never stored. Started, completed and the score are worked out
-- from the pupil's submissions each time they are read, so they cannot drift
-- from the work itself. Only cancellation is a decision, so only that is kept.

BEGIN;

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard';

ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_kind_check;
ALTER TABLE lessons
  ADD CONSTRAINT lessons_kind_check CHECK (kind IN ('standard', 'intervention'));

-- A pupil's intervention must never be in the public lesson browser.
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_intervention_not_public;
ALTER TABLE lessons
  ADD CONSTRAINT lessons_intervention_not_public CHECK (kind = 'standard' OR is_public = false);

COMMENT ON COLUMN lessons.kind IS
  'standard = a unit lesson taught to classes; intervention = written for one pupil (see intervention_assignments).';

-- Once set, a lesson's kind is fixed: turning an intervention into a class
-- lesson would put one pupil's work in front of the whole class.
CREATE OR REPLACE FUNCTION lessons_kind_is_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'A lesson''s kind cannot be changed (lesson %)', OLD.lesson_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lessons_kind_is_fixed ON lessons;
CREATE TRIGGER lessons_kind_is_fixed
  BEFORE UPDATE OF kind ON lessons
  FOR EACH ROW EXECUTE FUNCTION lessons_kind_is_fixed();

CREATE TABLE IF NOT EXISTS intervention_assignments (
  intervention_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: each intervention lesson belongs to exactly one pupil.
  lesson_id text NOT NULL UNIQUE REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  pupil_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  -- The class it was set from; used to filter reports.
  group_id text REFERENCES groups(group_id) ON DELETE SET NULL,
  set_by text REFERENCES profiles(user_id) ON DELETE SET NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  reason text NOT NULL DEFAULT '',
  source_assessment_id uuid REFERENCES assessments(assessment_id) ON DELETE SET NULL,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS intervention_assignments_pupil_idx ON intervention_assignments (pupil_id);
CREATE INDEX IF NOT EXISTS intervention_assignments_group_idx ON intervention_assignments (group_id);

COMMENT ON TABLE intervention_assignments IS
  'One pupil''s intervention lesson. Status and score are derived from submissions; only cancellation is stored.';

-- Only an intervention lesson can be assigned to a pupil this way.
CREATE OR REPLACE FUNCTION intervention_lesson_is_intervention() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM lessons WHERE lesson_id = NEW.lesson_id) IS DISTINCT FROM 'intervention' THEN
    RAISE EXCEPTION 'Lesson % is not an intervention lesson', NEW.lesson_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS intervention_lesson_is_intervention ON intervention_assignments;
CREATE TRIGGER intervention_lesson_is_intervention
  BEFORE INSERT OR UPDATE OF lesson_id ON intervention_assignments
  FOR EACH ROW EXECUTE FUNCTION intervention_lesson_is_intervention();

-- Classes reach lessons only through the planner (lesson_assignments is a
-- view over planner_assignments), so refusing intervention lessons here keeps
-- them out of every class view at once.
CREATE OR REPLACE FUNCTION planner_refuses_interventions() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM lessons WHERE lesson_id = NEW.lesson_id) = 'intervention' THEN
    RAISE EXCEPTION 'Lesson % is a pupil''s intervention and cannot be planned for a class', NEW.lesson_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planner_refuses_interventions ON planner_assignments;
CREATE TRIGGER planner_refuses_interventions
  BEFORE INSERT OR UPDATE OF lesson_id ON planner_assignments
  FOR EACH ROW EXECUTE FUNCTION planner_refuses_interventions();

-- Database functions that list a unit's lessons. Each is the live definition
-- with one added condition, so nothing else about them changes.

-- assignments_bootstrap: The assignment manager lists every lesson; a pupil's intervention is not one a class can be given.
CREATE OR REPLACE FUNCTION public.assignments_bootstrap()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        where kind = 'standard'
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
      ) as row_data
    ), '[]'::jsonb)
  );

  return result;
end;
$function$;

-- assignments_bootstrap_for_groups: Same list, scoped to the groups' units.
CREATE OR REPLACE FUNCTION public.assignments_bootstrap_for_groups(p_group_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          and l.kind = 'standard'
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
$function$;

-- lesson_detail_bootstrap: The lesson switcher lists the unit's lessons. An intervention lesson still sees itself, but no lesson sees another pupil's intervention.
CREATE OR REPLACE FUNCTION public.lesson_detail_bootstrap(p_lesson_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH target_lesson AS (
    SELECT *
    FROM lessons
    WHERE lesson_id = p_lesson_id
  ),
  lesson_payload AS (
    SELECT
      to_jsonb(tl) ||
        jsonb_build_object(
          'lesson_objectives', COALESCE((
            SELECT jsonb_agg(obj ORDER BY obj.order_by, obj.lesson_id, obj.learning_objective_id)
            FROM (
              SELECT
                llo.learning_objective_id,
                llo.lesson_id,
                COALESCE(llo.order_by, llo.order_index, 0) AS order_by,
                COALESCE(NULLIF(llo.title, ''), lo.title, 'Learning objective') AS title,
                COALESCE(llo.active, true) AS active,
                CASE WHEN lo.learning_objective_id IS NOT NULL THEN
                  to_jsonb(lo) ||
                  jsonb_build_object(
                    'title', COALESCE(lo.title, llo.title, 'Learning objective'),
                    'order_index', COALESCE(lo.order_index, llo.order_by, 0),
                    'active', COALESCE(lo.active, true),
                    'assessment_objective_code', ao.code,
                    'assessment_objective_title', ao.title,
                    'assessment_objective_order_index', ao.order_index,
                    'assessment_objective_curriculum_id', ao.curriculum_id,
                    'assessment_objective_unit_id', ao.unit_id,
                    'assessment_objective', CASE WHEN ao.assessment_objective_id IS NOT NULL THEN
                      jsonb_build_object(
                        'assessment_objective_id', ao.assessment_objective_id,
                        'code', ao.code,
                        'title', ao.title,
                        'order_index', ao.order_index,
                        'curriculum_id', ao.curriculum_id,
                        'unit_id', ao.unit_id
                      )
                    ELSE NULL END,
                    'success_criteria', COALESCE((
                      SELECT jsonb_agg(
                        jsonb_build_object(
                          'success_criteria_id', sc.success_criteria_id,
                          'learning_objective_id', sc.learning_objective_id,
                          'level', sc.level,
                          'description', sc.description,
                          'order_index', sc.order_index,
                          'active', COALESCE(sc.active, true),
                          'units', COALESCE((
                            SELECT jsonb_agg(scu.unit_id ORDER BY scu.unit_id)
                            FROM success_criteria_units scu
                            WHERE scu.success_criteria_id = sc.success_criteria_id
                          ), '[]'::jsonb)
                        )
                        ORDER BY sc.order_index, sc.level, sc.success_criteria_id
                      )
                      FROM success_criteria sc
                      WHERE sc.learning_objective_id = lo.learning_objective_id
                    ), '[]'::jsonb)
                  )
                ELSE NULL END AS learning_objective
              FROM lessons_learning_objective llo
              LEFT JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
              LEFT JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
              WHERE llo.lesson_id = tl.lesson_id
            ) obj
          ), '[]'::jsonb),
          'lesson_links', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'lesson_link_id', ll.lesson_link_id,
                'lesson_id', ll.lesson_id,
                'url', ll.url,
                'description', ll.description
              )
              ORDER BY ll.lesson_link_id
            )
            FROM lesson_links ll
            WHERE ll.lesson_id = tl.lesson_id
          ), '[]'::jsonb),
          'lesson_success_criteria', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'lesson_id', lsc.lesson_id,
                'success_criteria_id', lsc.success_criteria_id,
                'title', COALESCE(sc.description, 'Success criterion'),
                'description', sc.description,
                'level', sc.level,
                'learning_objective_id', sc.learning_objective_id,
                'activity_id', NULL,
                'is_summative', false
              )
              ORDER BY COALESCE(sc.level, 0), sc.success_criteria_id
            )
            FROM lesson_success_criteria lsc
            LEFT JOIN success_criteria sc ON sc.success_criteria_id = lsc.success_criteria_id
            WHERE lsc.lesson_id = tl.lesson_id
          ), '[]'::jsonb)
        ) AS payload
    FROM target_lesson tl
  ),
  unit_payload AS (
    SELECT row_to_json(u) AS payload
    FROM units u
    JOIN target_lesson tl ON tl.unit_id = u.unit_id
  ),
  unit_lessons AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'lesson_id', l.lesson_id,
        'unit_id', l.unit_id,
        'title', l.title,
        'order_by', l.order_by,
        'active', COALESCE(l.active, true)
      )
      ORDER BY l.order_by, l.title
    ), '[]'::jsonb) AS payload
    FROM lessons l
    JOIN target_lesson tl ON tl.unit_id = l.unit_id
    WHERE l.kind = 'standard' OR l.lesson_id = tl.lesson_id
  ),
  activity_base AS (
    SELECT *
    FROM activities
    WHERE lesson_id = p_lesson_id
  ),
  activity_success AS (
    SELECT
      act_sc.activity_id,
      jsonb_agg(act_sc.success_criteria_id ORDER BY act_sc.success_criteria_id) AS ids,
      jsonb_agg(
        jsonb_build_object(
          'success_criteria_id', act_sc.success_criteria_id,
          'learning_objective_id', sc.learning_objective_id,
          'title', COALESCE(sc.description, 'Success criterion'),
          'description', sc.description,
          'level', sc.level,
          'active', COALESCE(sc.active, true)
        )
        ORDER BY sc.level, sc.description, act_sc.success_criteria_id
      ) AS details
    FROM activity_success_criteria act_sc
    JOIN activity_base ab ON ab.activity_id = act_sc.activity_id
    LEFT JOIN success_criteria sc ON sc.success_criteria_id = act_sc.success_criteria_id
    GROUP BY act_sc.activity_id
  ),
  activity_payload AS (
    SELECT COALESCE(jsonb_agg(
      to_jsonb(ab) ||
        jsonb_build_object(
          'success_criteria_ids', COALESCE(asx.ids, '[]'::jsonb),
          'success_criteria', COALESCE(asx.details, '[]'::jsonb)
        )
      ORDER BY COALESCE(ab.order_by, 2147483647), ab.title, ab.activity_id
    ), '[]'::jsonb) AS payload
    FROM activity_base ab
    LEFT JOIN activity_success asx ON asx.activity_id = ab.activity_id
  ),
  files_payload AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'name', sf.file_name,
        'path', sf.scope_path || '/' || sf.file_name,
        'created_at', sf.created_at,
        'updated_at', sf.updated_at,
        'last_accessed_at', NULL,
        'size', sf.size_bytes
      )
      ORDER BY sf.updated_at DESC NULLS LAST, sf.created_at DESC NULLS LAST, sf.file_name
    ), '[]'::jsonb) AS payload
    FROM stored_files sf
    JOIN target_lesson tl
      ON sf.bucket = 'lessons'
     AND sf.scope_path = tl.lesson_id
    WHERE sf.file_name IS NOT NULL
      AND sf.file_name <> ''
    LIMIT 100
  )
  SELECT jsonb_build_object(
      'lesson', (SELECT payload FROM lesson_payload),
      'unit', (SELECT payload FROM unit_payload),
      'unitLessons', COALESCE((SELECT payload FROM unit_lessons), '[]'::jsonb),
      'lessonActivities', COALESCE((SELECT payload FROM activity_payload), '[]'::jsonb),
      'lessonFiles', COALESCE((SELECT payload FROM files_payload), '[]'::jsonb)
    )
  INTO result;

  RETURN result;
END;
$function$;

-- reports_get_prepared_report_dataset: Pupil reports list each unit's lessons; without this, every pupil's report would carry other pupils' interventions. Intervention results are reported separately.
-- Also returns attempt_number, which the app's SubmissionSchema has required
-- since 29-06-2026: without it every pupil report with work on it failed to load.
CREATE OR REPLACE FUNCTION public.reports_get_prepared_report_dataset(p_pupil_id text, p_group_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  with target_pupil as (
    select * from profiles where user_id = p_pupil_id
  ),
  target_group as (
    select * from groups where group_id = p_group_id
  ),
  profile_json as (
    select jsonb_build_object(
      'user_id', tp.user_id,
      'first_name', tp.first_name,
      'last_name', tp.last_name,
      'email', tp.email
    ) as data
    from target_pupil tp
  ),
  membership_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', gm.user_id,
      'group_id', gm.group_id,
      'role', ur.role_id,
      'subject', g.subject
    )), '[]'::jsonb) as data
    from group_membership gm
    join groups g on g.group_id = gm.group_id
    left join user_roles ur on ur.user_id = gm.user_id
    where gm.user_id = p_pupil_id
  ),
  assignments_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'group_id', la.group_id,
      'lesson_id', la.lesson_id,
      'unit_id', l.unit_id,
      'start_date', la.start_date,
      'end_date', la.start_date,
      'feedback_visible', la.feedback_visible,
      'unit', CASE WHEN u.unit_id IS NOT NULL THEN
        jsonb_build_object(
          'unit_id', u.unit_id,
          'title', u.title,
          'subject', u.subject,
          'description', u.description,
          'year', u.year
        )
      ELSE NULL END
    )), '[]'::jsonb) as data
    from lesson_assignments la
    join lessons l on l.lesson_id = la.lesson_id
    left join units u on u.unit_id = l.unit_id
    where (p_group_id IS NULL OR la.group_id = p_group_id)
      AND la.group_id IN (SELECT group_id FROM group_membership WHERE user_id = p_pupil_id)
  ),
  feedback_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'lesson_id', f.lesson_id,
      'success_criteria_id', f.success_criteria_id,
      'rating', f.rating
    )), '[]'::jsonb) as data
    from feedback f
    where f.user_id = p_pupil_id
  ),
  units_json as (
    select coalesce(jsonb_agg(unit_payload), '[]'::jsonb) as data
    from (
      with unit_ids as (
        select distinct l.unit_id
        from lesson_assignments la
        join lessons l on l.lesson_id = la.lesson_id
        join group_membership gm on gm.group_id = la.group_id
        where gm.user_id = p_pupil_id
          AND (p_group_id IS NULL OR la.group_id = p_group_id)
      )
      select jsonb_build_object(
        'unit_id', u.unit_id,
        'title', u.title,
        'subject', u.subject,
        'description', u.description,
        'year', u.year,
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
                    'attempt_number', s.attempt_number,
                    'submitted_at', s.submitted_at,
                    'body', s.body,
                    'is_flagged', s.is_flagged,
                    'resubmit_requested', s.resubmit_requested,
                    'resubmit_note', s.resubmit_note
                  ) as submission_payload
                  from submissions s
                  where s.activity_id in (
                    select a.activity_id
                    from activities a
                    where a.lesson_id = l.lesson_id
                  )
                    and s.user_id = p_pupil_id
                  order by s.submitted_at desc, s.submission_id
                ) submission_rows
              )
            ) as lesson_payload
            from lessons l
            where l.unit_id = u.unit_id
              and l.kind = 'standard'
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
    'memberships', coalesce((select data from membership_json), '[]'::jsonb),
    'assignments', coalesce((select data from assignments_json), '[]'::jsonb),
    'feedback', coalesce((select data from feedback_json), '[]'::jsonb),
    'units', coalesce((select data from units_json), '[]'::jsonb)
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

COMMIT;
