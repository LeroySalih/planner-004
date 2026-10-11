-- 117-progress-baseline.sql
--
-- One common baseline for every progress figure:
--
--   * Scope: every active scorable activity in every lesson set to the
--     pupil's class whose start date has arrived. Lessons set for later
--     don't count until they start.
--   * Numerator: marks from the pupil's latest attempt (highest
--     attempt_number). No submission, or not marked yet, is 0.
--   * Denominator: every such activity's max marks, submitted or not, so
--     missing work lowers the score instead of disappearing from it.
--   * Average: sum(marks) / sum(max_marks), never a mean of per-activity
--     percentages.
--   * Pupils only: staff who are also class members (see
--     src/lib/roles/pupil-membership.ts) are never counted.
--
-- pupil_activity_scores is that baseline, one row per pupil x activity.
-- Reports read it rather than each re-deriving their own rules.

BEGIN;

-- Keep in step with SCORABLE_ACTIVITY_TYPES in src/dino.config.ts.
CREATE OR REPLACE FUNCTION is_scorable_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_type, ''))) = ANY (ARRAY[
    'multiple-choice-question', 'short-text-question', 'text-question',
    'long-text-question', 'upload-file', 'upload-url', 'upload-spreadsheet',
    'upload-code', 'upload-worksheet', 'mark-worksheet', 'feedback',
    'sketch-render', 'do-flashcards', 'matcher', 'group-items', 'voice',
    'sequence'
  ])
$$;

CREATE OR REPLACE VIEW pupil_activity_scores AS
WITH pupils AS MATERIALIZED (
  -- Resolved once: a role predicate inside the main join flips the planner
  -- onto a far slower plan (see resolvePupilIds).
  SELECT ur.user_id FROM user_roles ur WHERE lower(ur.role_id) = 'pupil'
  EXCEPT
  SELECT ur.user_id FROM user_roles ur WHERE lower(ur.role_id) IN ('teacher', 'admin', 'technician')
)
SELECT
  la.group_id,
  gm.user_id AS pupil_id,
  l.unit_id,
  l.lesson_id,
  a.activity_id,
  a.type AS activity_type,
  coalesce(a.is_summative, false) AS is_summative,
  coalesce(a.max_marks, 1) AS max_marks,
  latest.submission_id,
  coalesce(latest.marks, 0) AS marks,
  -- Read here, while the body is already loaded, so the criterion view need
  -- not fetch large submission bodies a second time.
  latest.criterion_scores,
  latest.criterion_marks,
  la.start_date
FROM lesson_assignments la
JOIN lessons l ON l.lesson_id = la.lesson_id AND l.active IS NOT FALSE
JOIN activities a ON a.lesson_id = l.lesson_id AND a.active IS NOT FALSE AND is_scorable_activity_type(a.type)
JOIN group_membership gm ON gm.group_id = la.group_id
JOIN pupils p ON p.user_id = gm.user_id
LEFT JOIN LATERAL (
  SELECT s.submission_id,
         compute_submission_marks(s.body::jsonb, a.type, coalesce(a.max_marks, 1)) AS marks,
         s.body::jsonb -> 'success_criteria_scores' AS criterion_scores,
         -- Per-criterion marks (authoritative) as {criterion: fraction}, read
         -- by primary key here; joining the table from the criterion view
         -- planned as a 3-million-row filter.
         (SELECT jsonb_object_agg(scm.success_criteria_id, scm.awarded::numeric / nullif(scm.available, 0))
            FROM submission_sc_marks scm
           WHERE scm.submission_id = s.submission_id) AS criterion_marks
    FROM submissions s
   WHERE s.activity_id = a.activity_id AND s.user_id = gm.user_id
   ORDER BY s.attempt_number DESC, s.submitted_at DESC NULLS LAST, s.submission_id DESC
   LIMIT 1
) latest ON true
WHERE la.start_date <= current_date;

COMMENT ON VIEW pupil_activity_scores IS
  'Progress baseline: pupil x scorable activity in started class lessons; latest-attempt marks, missing = 0. Average as sum(marks)/sum(max_marks).';

-- The same baseline per success criterion, for the LO and criterion reports:
-- one row per pupil x activity x criterion linked to it. The rating (0-1) is
-- the latest attempt's mark for that criterion (submission_sc_marks is
-- authoritative, then the score cached on the submission body); a missing or
-- unmarked activity rates 0. Average ratings as a plain mean of these rows.
CREATE OR REPLACE VIEW pupil_criterion_scores AS
SELECT
  pas.group_id,
  pas.pupil_id,
  pas.unit_id,
  pas.lesson_id,
  pas.activity_id,
  pas.is_summative,
  ac.success_criteria_id,
  -- Clamped: some legacy bodies cached raw marks (e.g. 3) instead of 0-1.
  least(greatest(coalesce(
    (pas.criterion_marks ->> ac.success_criteria_id)::numeric,
    (pas.criterion_scores ->> ac.success_criteria_id)::numeric,
    0
  ), 0), 1) AS rating
FROM pupil_activity_scores pas
JOIN activity_success_criteria ac ON ac.activity_id = pas.activity_id;

COMMENT ON VIEW pupil_criterion_scores IS
  'Progress baseline per success criterion: pupil x activity x linked criterion; latest-attempt rating 0-1, missing = 0.';

-- Lesson averages on the teacher planner: the baseline, per class and lesson.
CREATE OR REPLACE FUNCTION public.lesson_assignment_score_summaries(pairs jsonb)
 RETURNS TABLE(group_id text, lesson_id text, activities_average numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 -- JIT compiling the baseline view's plan cost one first call 15s against a
 -- steady ~0.4s; these are small interactive queries, so never JIT them.
 SET jit TO off
AS $function$
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
  aggregated as (
    select pas.group_id, pas.lesson_id,
           sum(pas.marks)::numeric as marks,
           sum(pas.max_marks)::numeric as max_marks,
           bool_or(pas.submission_id is not null) as has_submission
      from pupil_activity_scores pas
      join dedup_pairs dp on dp.group_id = pas.group_id and dp.lesson_id = pas.lesson_id
     group by pas.group_id, pas.lesson_id
  )
  select
    dp.group_id,
    dp.lesson_id,
    case
      when agg.has_submission and agg.max_marks > 0 then clamp_score(agg.marks / agg.max_marks)
      else null
    end as activities_average
  from dedup_pairs dp
  left join aggregated agg on agg.group_id = dp.group_id and agg.lesson_id = dp.lesson_id
  order by dp.group_id, dp.lesson_id;
end;
$function$;

-- Dashboard green/amber/red: each pupil's baseline score across the
-- teacher's classes. A pupil with nothing set yet scores 0, as before.
CREATE OR REPLACE FUNCTION public.dashboard_class_progress_summary(p_teacher_id text)
 RETURNS TABLE(group_id text, group_subject text, total_pupils bigint, green_count bigint, amber_count bigint, red_count bigint)
 LANGUAGE sql
 STABLE
 SET jit TO off
AS $function$
  WITH teacher_groups AS (
    SELECT gm.group_id
    FROM group_membership gm
    JOIN groups g ON g.group_id = gm.group_id AND coalesce(g.active, true) = true
    WHERE gm.user_id = p_teacher_id
  ),
  pupil_members AS (
    SELECT gm.group_id, gm.user_id AS pupil_id
    FROM group_membership gm
    JOIN teacher_groups tg ON tg.group_id = gm.group_id
    WHERE gm.user_id != p_teacher_id
      AND exists (
        SELECT 1 FROM user_roles ur
         WHERE ur.user_id = gm.user_id AND lower(ur.role_id) = 'pupil'
      )
      AND NOT exists (
        SELECT 1 FROM user_roles ur
         WHERE ur.user_id = gm.user_id
           AND lower(ur.role_id) IN ('teacher', 'admin', 'technician')
      )
  ),
  pupil_scores AS (
    SELECT pas.group_id, pas.pupil_id,
           sum(pas.marks)::numeric / nullif(sum(pas.max_marks), 0) AS score
      FROM pupil_activity_scores pas
      JOIN teacher_groups tg ON tg.group_id = pas.group_id
     GROUP BY pas.group_id, pas.pupil_id
  ),
  all_pupils AS (
    SELECT pm.group_id, pm.pupil_id, coalesce(ps.score, 0) AS avg_score
    FROM pupil_members pm
    LEFT JOIN pupil_scores ps ON ps.group_id = pm.group_id AND ps.pupil_id = pm.pupil_id
  )
  SELECT
    g.group_id,
    g.subject AS group_subject,
    count(*) AS total_pupils,
    count(*) FILTER (WHERE ap.avg_score >= 0.70) AS green_count,
    count(*) FILTER (WHERE ap.avg_score >= 0.40 AND ap.avg_score < 0.70) AS amber_count,
    count(*) FILTER (WHERE ap.avg_score < 0.40) AS red_count
  FROM all_pupils ap
  JOIN groups g ON g.group_id = ap.group_id
  GROUP BY g.group_id, g.subject
  ORDER BY g.group_id;
$function$;

-- Pupil reports score activities out of their real max marks. The dataset
-- never carried max_marks, so the report treated every activity as out of 1
-- (a 1/2 counted as full marks). Same function as migration 108, plus
-- 'max_marks' on each activity.
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
                    'max_marks', coalesce(a.max_marks, 1),
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
