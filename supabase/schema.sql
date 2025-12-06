


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE OR REPLACE FUNCTION "public"."assignments_bootstrap"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."assignments_bootstrap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clamp_score"("score" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when score is null then null
    when score < 0 then 0::numeric
    when score > 1 then 1::numeric
    else score
  end;
$$;


ALTER FUNCTION "public"."clamp_score"("score" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_submission_base_score"("body" json, "activity_type" "text") RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  select compute_submission_base_score(body::jsonb, activity_type);
$$;


ALTER FUNCTION "public"."compute_submission_base_score"("body" json, "activity_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_submission_base_score"("body" "jsonb", "activity_type" "text") RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    AS $$
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
$$;


ALTER FUNCTION "public"."compute_submission_base_score"("body" "jsonb", "activity_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_short_text_submission"("p_activity_id" "text", "p_pupil_id" "text") RETURNS TABLE("submission_id" "text", "activity_id" "text", "lesson_id" "text", "activity_question" "text", "activity_model_answer" "text", "pupil_answer" "text", "submitted_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  latest_submission record;
  activity_row record;
begin
  select s.submission_id,
         s.activity_id,
         s.user_id,
         s.submitted_at,
         s.body
    into latest_submission
    from public.submissions s
   where s.activity_id = p_activity_id
     and s.user_id = p_pupil_id
   order by coalesce(s.submitted_at, timezone('utc', now())) desc
   limit 1;

  select a.activity_id,
         a.lesson_id,
         a.type,
         a.body_data
    into activity_row
    from public.activities a
   where a.activity_id = p_activity_id;

  if activity_row.activity_id is null then
    return;
  end if;

  if coalesce(activity_row.type, '') <> 'short-text-question' then
    return;
  end if;

  return query
  select
    latest_submission.submission_id,
    activity_row.activity_id,
    activity_row.lesson_id,
    activity_row.body_data ->> 'question' as activity_question,
    activity_row.body_data ->> 'modelAnswer' as activity_model_answer,
    (latest_submission.body::jsonb ->> 'answer') as pupil_answer,
    latest_submission.submitted_at;
end;
$$;


ALTER FUNCTION "public"."get_latest_short_text_submission"("p_activity_id" "text", "p_pupil_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lesson_assignment_score_summaries"("pairs" "jsonb") RETURNS TABLE("group_id" "text", "lesson_id" "text", "activities_average" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
$$;


ALTER FUNCTION "public"."lesson_assignment_score_summaries"("pairs" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lesson_detail_bootstrap"("p_lesson_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'storage'
    AS $$
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
        'name', regexp_replace(obj.name, '^[^/]+/', ''),
        'path', obj.name,
        'created_at', obj.created_at,
        'updated_at', obj.updated_at,
        'last_accessed_at', obj.last_accessed_at,
        'size', NULLIF((obj.metadata ->> 'size')::bigint, 0)
      )
      ORDER BY obj.updated_at DESC NULLS LAST, obj.created_at DESC NULLS LAST, obj.name
    ), '[]'::jsonb) AS payload
    FROM (
      SELECT o.*
      FROM storage.objects o
      JOIN target_lesson tl
        ON o.bucket_id = 'lessons'
       AND o.name LIKE tl.lesson_id || '/%'
       AND regexp_replace(o.name, '^[^/]+/', '') <> ''
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST, o.name
      LIMIT 100
    ) obj
  )
  SELECT jsonb_build_object(
      'lesson', (SELECT payload FROM lesson_payload),
      'unit', (SELECT payload FROM unit_payload),
      'unitLessons', COALESCE((SELECT payload FROM unit_lessons), '[]'::jsonb),
      'lessonActivities', COALESCE((SELECT payload FROM activity_payload), '[]'::jsonb),
      'lessonFiles', COALESCE((SELECT payload FROM files_payload), '[]'::jsonb)
    )
  INTO result;

  IF result IS NULL THEN
    RETURN jsonb_build_object(
      'lesson', NULL,
      'unit', NULL,
      'unitLessons', '[]'::jsonb,
      'lessonActivities', '[]'::jsonb,
      'lessonFiles', '[]'::jsonb
    );
  END IF;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."lesson_detail_bootstrap"("p_lesson_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lesson_reference_bootstrap"("p_lesson_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  result jsonb;
BEGIN
  WITH curriculum_ids AS (
    SELECT curriculum_id
    FROM curricula
    WHERE curriculum_id IS NOT NULL
      AND COALESCE(active, true) = true
  ),
  curricula_payload AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'curriculum_id', c.curriculum_id,
        'title', c.title,
        'subject', c.subject,
        'description', c.description,
        'active', COALESCE(c.active, true)
      )
      ORDER BY c.title, c.curriculum_id
    ), '[]'::jsonb) AS payload
    FROM curricula c
    WHERE c.curriculum_id IN (SELECT curriculum_id FROM curriculum_ids)
  ),
  assessment_payload AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'assessment_objective_id', ao.assessment_objective_id,
        'curriculum_id', ao.curriculum_id,
        'unit_id', ao.unit_id,
        'code', ao.code,
        'title', ao.title,
        'order_index', ao.order_index
      )
      ORDER BY ao.curriculum_id, ao.order_index NULLS FIRST, ao.title, ao.assessment_objective_id
    ), '[]'::jsonb) AS payload
    FROM assessment_objectives ao
    WHERE ao.curriculum_id IN (SELECT curriculum_id FROM curriculum_ids)
  )
  SELECT jsonb_build_object(
      'curricula', COALESCE((SELECT payload FROM curricula_payload), '[]'::jsonb),
      'assessmentObjectives', COALESCE((SELECT payload FROM assessment_payload), '[]'::jsonb)
    )
  INTO result;

  IF result IS NULL THEN
    RETURN jsonb_build_object(
      'curricula', '[]'::jsonb,
      'assessmentObjectives', '[]'::jsonb
    );
  END IF;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."lesson_reference_bootstrap"("p_lesson_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_count" integer DEFAULT 10, "filter" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("id" bigint, "content" "text", "metadata" "jsonb", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.metadata @> filter
  order by d.embedding <=> query_embedding
  limit match_count
$$;


ALTER FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_count" integer, "filter" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pupil_lessons_detail_bootstrap"("p_target_user_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
      lower(coalesce(gm.role, '')) as role,
      g.subject,
      coalesce(g.active, true) as group_active
    from group_membership gm
    join groups g on g.group_id = gm.group_id
    where lower(coalesce(gm.role, '')) = 'pupil'
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
    select
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
    where ao.unit_id in (select unit_id from unit_ids)
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


ALTER FUNCTION "public"."pupil_lessons_detail_bootstrap"("p_target_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pupil_lessons_summary_bootstrap"("p_target_user_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result jsonb;
begin
  with target_pupils as (
    select distinct gm.user_id
    from group_membership gm
    where lower(coalesce(gm.role, '')) = 'pupil'
      and (p_target_user_id is null or gm.user_id = p_target_user_id)
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
      lower(coalesce(gm.role, '')) as role,
      g.subject,
      coalesce(g.active, true) as group_active
    from group_membership gm
    join groups g on g.group_id = gm.group_id
    where lower(coalesce(gm.role, '')) = 'pupil'
      and coalesce(g.active, true) = true
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


ALTER FUNCTION "public"."pupil_lessons_summary_bootstrap"("p_target_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reports_get_prepared_report_dataset"("p_pupil_id" "text", "p_group_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
$$;


ALTER FUNCTION "public"."reports_get_prepared_report_dataset"("p_pupil_id" "text", "p_group_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reports_list_pupils_with_groups"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
$$;


ALTER FUNCTION "public"."reports_list_pupils_with_groups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reports_recalculate_pupil_cache"("p_pupil_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  dataset jsonb;
begin
  if coalesce(trim(p_pupil_id), '') = '' then
    raise exception 'pupil id is required';
  end if;

  select public.reports_get_prepared_report_dataset(p_pupil_id, null)
    into dataset;

  if dataset is null then
    dataset := '{}'::jsonb;
  end if;

  insert into public.report_pupil_cache (pupil_id, dataset, calculated_at)
  values (p_pupil_id, dataset, now())
  on conflict (pupil_id) do update
    set dataset = excluded.dataset,
        calculated_at = excluded.calculated_at;

  delete from public.report_pupil_feedback_cache where pupil_id = p_pupil_id;

  insert into public.report_pupil_feedback_cache (pupil_id, success_criteria_id, latest_feedback_id, latest_rating, updated_at)
  select
    p_pupil_id as pupil_id,
    latest.success_criteria_id,
    latest.id,
    latest.rating,
    now()
  from (
    select distinct on (success_criteria_id)
      success_criteria_id,
      id,
      rating
    from public.feedback
    where user_id = p_pupil_id
    order by success_criteria_id, id desc
  ) as latest
  where coalesce(trim(latest.success_criteria_id), '') <> '';

  return dataset;
end;
$$;


ALTER FUNCTION "public"."reports_recalculate_pupil_cache"("p_pupil_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reports_store_pupil_unit_summaries"("p_pupil_id" "text", "p_units" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
begin
  if coalesce(trim(p_pupil_id), '') = '' then
    raise exception 'pupil id is required';
  end if;

  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'units payload must be a json array';
  end if;

  delete from public.report_pupil_unit_summaries where pupil_id = p_pupil_id;

  insert into public.report_pupil_unit_summaries (
    pupil_id,
    unit_id,
    unit_title,
    unit_subject,
    unit_description,
    unit_year,
    related_group_ids,
    grouped_levels,
    working_level,
    activities_average,
    assessment_average,
    assessment_level,
    score_error,
    objective_error,
    updated_at
  )
  select
    p_pupil_id,
    unit->>'unitId',
    nullif(unit->>'unitTitle', ''),
    nullif(unit->>'unitSubject', ''),
    nullif(unit->>'unitDescription', ''),
    case when (unit->>'unitYear') ~ '^-?\\d+$' then (unit->>'unitYear')::integer else null end,
    coalesce(
      array(
        select elem::text
        from jsonb_array_elements_text(coalesce(unit->'relatedGroups', '[]'::jsonb)) as elem
      ),
      '{}'
    ),
    coalesce(unit->'groupedLevels', '[]'::jsonb),
    case when (unit->>'workingLevel') ~ '^-?\\d+$' then (unit->>'workingLevel')::integer else null end,
    nullif(unit->>'activitiesAverage', '')::double precision,
    nullif(unit->>'assessmentAverage', '')::double precision,
    nullif(unit->>'assessmentLevel', ''),
    nullif(unit->>'scoreError', ''),
    nullif(unit->>'objectiveError', ''),
    now()
  from jsonb_array_elements(p_units) as unit;
end;
$_$;


ALTER FUNCTION "public"."reports_store_pupil_unit_summaries"("p_pupil_id" "text", "p_units" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_numeric"("value" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
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
$$;


ALTER FUNCTION "public"."safe_numeric"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_learning_objectives_order_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  next_order integer;
BEGIN
  -- If order_by is provided AND positive, respect it; otherwise compute it
  IF COALESCE(NEW.order_by, 0) > 0 THEN
    RETURN NEW;
  END IF;

  -- Concurrency safety: transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('learning_objectives.order_by'));

  SELECT COALESCE(MAX(order_by), 0) + 1
    INTO next_order
  FROM learning_objectives;

  NEW.order_by := next_order;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_learning_objectives_order_by"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_lessons_order_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  next_order integer;
BEGIN
  -- If order_by is provided AND positive, respect it; otherwise compute it
  IF COALESCE(NEW.order_by, 0) > 0 THEN
    RETURN NEW;
  END IF;

  -- Concurrency safety: transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('lessons.order_by'));

  SELECT COALESCE(MAX(order_by), 0) + 1
    INTO next_order
  FROM lessons;

  NEW.order_by := next_order;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_lessons_order_by"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "activity_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "lesson_id" "text",
    "title" "text",
    "type" "text",
    "body_data" "jsonb",
    "is_homework" boolean DEFAULT false,
    "order_by" integer,
    "active" boolean DEFAULT true,
    "is_summative" boolean DEFAULT false,
    "notes" "text"
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_success_criteria" (
    "activity_id" "text" NOT NULL,
    "success_criteria_id" "text" NOT NULL
);


ALTER TABLE "public"."activity_success_criteria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessment_objectives" (
    "assessment_objective_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "curriculum_id" "text",
    "unit_id" "text",
    "code" "text" NOT NULL,
    "title" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."assessment_objectives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "group_id" "text" NOT NULL,
    "unit_id" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."curricula" (
    "curriculum_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."curricula" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" bigint NOT NULL,
    "content" "text",
    "metadata" "jsonb",
    "embedding" "public"."vector"(768)
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."documents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."documents_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."documents_id_seq" OWNED BY "public"."documents"."id";



CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" integer NOT NULL,
    "user_id" "text" NOT NULL,
    "lesson_id" "text" NOT NULL,
    "success_criteria_id" "text" NOT NULL,
    "rating" integer NOT NULL
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."feedback_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."feedback_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."feedback_id_seq" OWNED BY "public"."feedback"."id";



CREATE TABLE IF NOT EXISTS "public"."group_membership" (
    "group_id" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "role" "text" NOT NULL
);


ALTER TABLE "public"."group_membership" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "group_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "join_code" "text",
    "subject" "text",
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_objectives" (
    "learning_objective_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "assessment_objective_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "spec_ref" "text"
);


ALTER TABLE "public"."learning_objectives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_assignments" (
    "group_id" "text" NOT NULL,
    "lesson_id" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "feedback_visible" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."lesson_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_links" (
    "lesson_link_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "lesson_id" "text",
    "url" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."lesson_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_success_criteria" (
    "lesson_id" "text" NOT NULL,
    "success_criteria_id" "text" NOT NULL
);


ALTER TABLE "public"."lesson_success_criteria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lessons" (
    "lesson_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "order_by" integer NOT NULL
);


ALTER TABLE "public"."lessons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lessons_learning_objective" (
    "learning_objective_id" "text" NOT NULL,
    "lesson_id" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "title" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "order_by" integer NOT NULL
);


ALTER TABLE "public"."lessons_learning_objective" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."n8n_chat_histories" (
    "id" integer NOT NULL,
    "session_id" character varying(255) NOT NULL,
    "message" "jsonb" NOT NULL
);


ALTER TABLE "public"."n8n_chat_histories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."n8n_chat_histories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."n8n_chat_histories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."n8n_chat_histories_id_seq" OWNED BY "public"."n8n_chat_histories"."id";



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "is_teacher" boolean DEFAULT false
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pupil_sign_in_history" (
    "pupil_sign_in_history_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "pupil_id" "text" NOT NULL,
    "url" "text" NOT NULL,
    "signed_in_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pupil_sign_in_history_pupil_id_fkey" FOREIGN KEY ("pupil_id")
        REFERENCES "public"."profiles" ("user_id")
);


ALTER TABLE "public"."pupil_sign_in_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_pupil_cache" (
    "pupil_id" "text" NOT NULL,
    "dataset" "jsonb" NOT NULL,
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."report_pupil_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."report_pupil_cache" IS 'Precomputed per-pupil report dataset payloads powering /reports views.';



COMMENT ON COLUMN "public"."report_pupil_cache"."dataset" IS 'Full dataset as returned by reports_get_prepared_report_dataset.';



CREATE TABLE IF NOT EXISTS "public"."report_pupil_feedback_cache" (
    "pupil_id" "text" NOT NULL,
    "success_criteria_id" "text" NOT NULL,
    "latest_feedback_id" bigint NOT NULL,
    "latest_rating" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."report_pupil_feedback_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."report_pupil_feedback_cache" IS 'Latest feedback/rating snapshot per pupil and success criterion for group-level aggregations.';



CREATE TABLE IF NOT EXISTS "public"."report_pupil_unit_summaries" (
    "pupil_id" "text" NOT NULL,
    "unit_id" "text" NOT NULL,
    "unit_title" "text",
    "unit_subject" "text",
    "unit_description" "text",
    "unit_year" integer,
    "related_group_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "grouped_levels" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "working_level" integer,
    "activities_average" double precision,
    "assessment_average" double precision,
    "assessment_level" "text",
    "score_error" "text",
    "objective_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."report_pupil_unit_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."short_text_feedback_events" (
    "feedback_event_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "assignment_id" "text",
    "lesson_id" "text",
    "activity_id" "text" NOT NULL,
    "submission_id" "text",
    "pupil_id" "text" NOT NULL,
    "activity_question" "text",
    "activity_model_answer" "text",
    "pupil_answer" "text",
    "ai_score" numeric,
    "ai_feedback" "text",
    "request_context" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."short_text_feedback_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subjects" (
    "subject" "text" NOT NULL,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "submission_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "body" json,
    "replication_pk" bigint NOT NULL
);

ALTER TABLE ONLY "public"."submissions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."submissions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."submissions_replication_pk_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."submissions_replication_pk_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."submissions_replication_pk_seq" OWNED BY "public"."submissions"."replication_pk";



CREATE TABLE IF NOT EXISTS "public"."success_criteria" (
    "success_criteria_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "learning_objective_id" "text" NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "description" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."success_criteria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."success_criteria_units" (
    "success_criteria_id" "text" NOT NULL,
    "unit_id" "text" NOT NULL
);


ALTER TABLE "public"."success_criteria_units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."units" (
    "unit_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text",
    "subject" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "description" character varying,
    "year" integer
);


ALTER TABLE "public"."units" OWNER TO "postgres";


ALTER TABLE ONLY "public"."documents" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."documents_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."feedback" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."feedback_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."n8n_chat_histories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."n8n_chat_histories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."submissions" ALTER COLUMN "replication_pk" SET DEFAULT "nextval"('"public"."submissions_replication_pk_seq"'::"regclass");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("activity_id");



ALTER TABLE ONLY "public"."activity_success_criteria"
    ADD CONSTRAINT "activity_success_criteria_pkey" PRIMARY KEY ("activity_id", "success_criteria_id");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_curriculum_id_code_key" UNIQUE ("curriculum_id", "code");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_pkey" PRIMARY KEY ("assessment_objective_id");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_unit_id_key" UNIQUE ("unit_id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("group_id", "unit_id", "start_date");



ALTER TABLE ONLY "public"."curricula"
    ADD CONSTRAINT "curricula_pkey" PRIMARY KEY ("curriculum_id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("group_id");



ALTER TABLE ONLY "public"."learning_objectives"
    ADD CONSTRAINT "learning_objectives_pkey" PRIMARY KEY ("learning_objective_id");



ALTER TABLE ONLY "public"."lesson_assignments"
    ADD CONSTRAINT "lesson_assignments_pkey" PRIMARY KEY ("group_id", "lesson_id", "start_date");



ALTER TABLE ONLY "public"."lesson_links"
    ADD CONSTRAINT "lesson_links_pkey" PRIMARY KEY ("lesson_link_id");



ALTER TABLE ONLY "public"."lesson_success_criteria"
    ADD CONSTRAINT "lesson_success_criteria_pkey" PRIMARY KEY ("lesson_id", "success_criteria_id");



ALTER TABLE ONLY "public"."lessons_learning_objective"
    ADD CONSTRAINT "lessons_learning_objective_pkey" PRIMARY KEY ("learning_objective_id", "lesson_id");



ALTER TABLE ONLY "public"."lessons"
    ADD CONSTRAINT "lessons_pkey" PRIMARY KEY ("lesson_id");



ALTER TABLE ONLY "public"."n8n_chat_histories"
    ADD CONSTRAINT "n8n_chat_histories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."report_pupil_cache"
    ADD CONSTRAINT "report_pupil_cache_pkey" PRIMARY KEY ("pupil_id");



ALTER TABLE ONLY "public"."report_pupil_feedback_cache"
    ADD CONSTRAINT "report_pupil_feedback_cache_pkey" PRIMARY KEY ("pupil_id", "success_criteria_id");



ALTER TABLE ONLY "public"."report_pupil_unit_summaries"
    ADD CONSTRAINT "report_pupil_unit_summaries_pkey" PRIMARY KEY ("pupil_id", "unit_id");



ALTER TABLE ONLY "public"."short_text_feedback_events"
    ADD CONSTRAINT "short_text_feedback_events_pkey" PRIMARY KEY ("feedback_event_id");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_pkey" PRIMARY KEY ("subject");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_replication_pk_pkey" PRIMARY KEY ("replication_pk");



ALTER TABLE ONLY "public"."success_criteria"
    ADD CONSTRAINT "success_criteria_pkey" PRIMARY KEY ("success_criteria_id");



ALTER TABLE ONLY "public"."success_criteria_units"
    ADD CONSTRAINT "success_criteria_units_pkey" PRIMARY KEY ("success_criteria_id", "unit_id");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY ("unit_id");



CREATE INDEX "assessment_objectives_curriculum_id_idx" ON "public"."assessment_objectives" USING "btree" ("curriculum_id");



CREATE INDEX "documents_embedding_hnsw" ON "public"."documents" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE UNIQUE INDEX "feedback_unique_user_lesson_criterion" ON "public"."feedback" USING "btree" ("user_id", "lesson_id", "success_criteria_id");



CREATE INDEX "idx_activities_lesson_order" ON "public"."activities" USING "btree" ("lesson_id", "order_by", "activity_id");



CREATE INDEX "idx_activity_success_criteria_success_activity" ON "public"."activity_success_criteria" USING "btree" ("success_criteria_id", "activity_id");



CREATE INDEX "idx_feedback_lesson_user" ON "public"."feedback" USING "btree" ("lesson_id", "user_id");



CREATE INDEX "idx_group_membership_group_user" ON "public"."group_membership" USING "btree" ("group_id", "user_id");



CREATE INDEX "idx_group_membership_user_group" ON "public"."group_membership" USING "btree" ("user_id", "group_id");



CREATE UNIQUE INDEX "idx_groups_join_code_unique" ON "public"."groups" USING "btree" ("join_code") WHERE ("join_code" IS NOT NULL);



CREATE INDEX "idx_lesson_assignments_lesson_group" ON "public"."lesson_assignments" USING "btree" ("lesson_id", "group_id", "start_date");



CREATE INDEX "idx_lesson_links_lesson" ON "public"."lesson_links" USING "btree" ("lesson_id", "lesson_link_id");



CREATE INDEX "idx_lessons_learning_objective_lesson_order" ON "public"."lessons_learning_objective" USING "btree" ("lesson_id", "order_by", "learning_objective_id");



CREATE INDEX "idx_lessons_unit_order" ON "public"."lessons" USING "btree" ("unit_id", "order_by", "lesson_id");



CREATE INDEX "idx_report_pupil_feedback_cache_criteria" ON "public"."report_pupil_feedback_cache" USING "btree" ("success_criteria_id", "pupil_id");



CREATE INDEX "idx_report_pupil_unit_summaries_group_ids" ON "public"."report_pupil_unit_summaries" USING "gin" ("related_group_ids");



CREATE INDEX "idx_report_pupil_unit_summaries_pupil_subject" ON "public"."report_pupil_unit_summaries" USING "btree" ("pupil_id", "unit_subject");



CREATE INDEX "idx_report_pupil_unit_summaries_subject" ON "public"."report_pupil_unit_summaries" USING "btree" ("unit_subject");



CREATE INDEX "idx_submissions_activity_submitted" ON "public"."submissions" USING "btree" ("activity_id", "submitted_at" DESC, "submission_id");



CREATE INDEX "idx_submissions_activity_user" ON "public"."submissions" USING "btree" ("activity_id", "user_id");



CREATE UNIQUE INDEX "idx_submissions_submission_id_unique" ON "public"."submissions" USING "btree" ("submission_id");



CREATE INDEX "idx_success_criteria_units_unit" ON "public"."success_criteria_units" USING "btree" ("unit_id", "success_criteria_id");



CREATE INDEX "learning_objectives_assessment_objective_id_idx" ON "public"."learning_objectives" USING "btree" ("assessment_objective_id", "order_index");



CREATE INDEX "short_text_feedback_events_activity_pupil_idx" ON "public"."short_text_feedback_events" USING "btree" ("activity_id", "pupil_id");



CREATE INDEX "short_text_feedback_events_assignment_pupil_idx" ON "public"."short_text_feedback_events" USING "btree" ("assignment_id", "pupil_id");



CREATE INDEX "success_criteria_learning_objective_idx" ON "public"."success_criteria" USING "btree" ("learning_objective_id", "order_index");



CREATE OR REPLACE TRIGGER "trg_set_lessons_order_by" BEFORE INSERT ON "public"."lessons" FOR EACH ROW EXECUTE FUNCTION "public"."set_lessons_order_by"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("lesson_id");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("curriculum_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."curricula"
    ADD CONSTRAINT "curricula_subject_fkey" FOREIGN KEY ("subject") REFERENCES "public"."subjects"("subject") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_membership"
    ADD CONSTRAINT "group_membership_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("group_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_objectives"
    ADD CONSTRAINT "learning_objectives_assessment_objective_id_fkey" FOREIGN KEY ("assessment_objective_id") REFERENCES "public"."assessment_objectives"("assessment_objective_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lesson_links"
    ADD CONSTRAINT "lesson_links_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("lesson_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lessons_learning_objective"
    ADD CONSTRAINT "lessons_learning_objective_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "public"."learning_objectives"("learning_objective_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lessons_learning_objective"
    ADD CONSTRAINT "lessons_learning_objective_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("lesson_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lessons"
    ADD CONSTRAINT "lessons_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_pupil_cache"
    ADD CONSTRAINT "report_pupil_cache_pupil_id_fkey" FOREIGN KEY ("pupil_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_pupil_feedback_cache"
    ADD CONSTRAINT "report_pupil_feedback_cache_pupil_id_fkey" FOREIGN KEY ("pupil_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_pupil_unit_summaries"
    ADD CONSTRAINT "report_pupil_unit_summaries_pupil_id_fkey" FOREIGN KEY ("pupil_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."short_text_feedback_events"
    ADD CONSTRAINT "short_text_feedback_events_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("activity_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."short_text_feedback_events"
    ADD CONSTRAINT "short_text_feedback_events_pupil_id_fkey" FOREIGN KEY ("pupil_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."short_text_feedback_events"
    ADD CONSTRAINT "short_text_feedback_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("submission_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."success_criteria"
    ADD CONSTRAINT "success_criteria_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "public"."learning_objectives"("learning_objective_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."success_criteria_units"
    ADD CONSTRAINT "success_criteria_units_success_criteria_id_fkey" FOREIGN KEY ("success_criteria_id") REFERENCES "public"."success_criteria"("success_criteria_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."success_criteria_units"
    ADD CONSTRAINT "success_criteria_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_subject_fkey" FOREIGN KEY ("subject") REFERENCES "public"."subjects"("subject");



CREATE POLICY "Authenticated Insert" ON "public"."learning_objectives" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated Update" ON "public"."learning_objectives" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable read access for all users" ON "public"."learning_objectives" FOR SELECT USING (true);



CREATE POLICY "Insert - Authenticated" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert - Authenticated Only" ON "public"."curricula" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Select - All" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Select - Authenticated Only" ON "public"."curricula" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Update - Authenticated Only" ON "public"."curricula" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update - Authenticated Only" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."curricula" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_objectives" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."submissions";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."assignments_bootstrap"() TO "anon";
GRANT ALL ON FUNCTION "public"."assignments_bootstrap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assignments_bootstrap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."clamp_score"("score" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."clamp_score"("score" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."clamp_score"("score" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_submission_base_score"("body" json, "activity_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_submission_base_score"("body" json, "activity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_submission_base_score"("body" json, "activity_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_submission_base_score"("body" "jsonb", "activity_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_submission_base_score"("body" "jsonb", "activity_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_submission_base_score"("body" "jsonb", "activity_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_latest_short_text_submission"("p_activity_id" "text", "p_pupil_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_short_text_submission"("p_activity_id" "text", "p_pupil_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_short_text_submission"("p_activity_id" "text", "p_pupil_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."lesson_assignment_score_summaries"("pairs" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."lesson_assignment_score_summaries"("pairs" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lesson_assignment_score_summaries"("pairs" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."lesson_detail_bootstrap"("p_lesson_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lesson_detail_bootstrap"("p_lesson_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lesson_detail_bootstrap"("p_lesson_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lesson_reference_bootstrap"("p_lesson_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lesson_reference_bootstrap"("p_lesson_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lesson_reference_bootstrap"("p_lesson_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_count" integer, "filter" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_count" integer, "filter" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_count" integer, "filter" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."pupil_lessons_detail_bootstrap"("p_target_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pupil_lessons_detail_bootstrap"("p_target_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pupil_lessons_detail_bootstrap"("p_target_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pupil_lessons_summary_bootstrap"("p_target_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pupil_lessons_summary_bootstrap"("p_target_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pupil_lessons_summary_bootstrap"("p_target_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reports_get_prepared_report_dataset"("p_pupil_id" "text", "p_group_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reports_get_prepared_report_dataset"("p_pupil_id" "text", "p_group_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reports_get_prepared_report_dataset"("p_pupil_id" "text", "p_group_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reports_list_pupils_with_groups"() TO "anon";
GRANT ALL ON FUNCTION "public"."reports_list_pupils_with_groups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reports_list_pupils_with_groups"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reports_recalculate_pupil_cache"("p_pupil_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reports_recalculate_pupil_cache"("p_pupil_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reports_recalculate_pupil_cache"("p_pupil_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reports_store_pupil_unit_summaries"("p_pupil_id" "text", "p_units" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."reports_store_pupil_unit_summaries"("p_pupil_id" "text", "p_units" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reports_store_pupil_unit_summaries"("p_pupil_id" "text", "p_units" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."safe_numeric"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."safe_numeric"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."safe_numeric"("value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_learning_objectives_order_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_learning_objectives_order_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_learning_objectives_order_by"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_lessons_order_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_lessons_order_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_lessons_order_by"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";









GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."activity_success_criteria" TO "anon";
GRANT ALL ON TABLE "public"."activity_success_criteria" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_success_criteria" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_objectives" TO "anon";
GRANT ALL ON TABLE "public"."assessment_objectives" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_objectives" TO "service_role";



GRANT ALL ON TABLE "public"."assignments" TO "anon";
GRANT ALL ON TABLE "public"."assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."assignments" TO "service_role";



GRANT ALL ON TABLE "public"."curricula" TO "anon";
GRANT ALL ON TABLE "public"."curricula" TO "authenticated";
GRANT ALL ON TABLE "public"."curricula" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feedback_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feedback_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feedback_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."group_membership" TO "anon";
GRANT ALL ON TABLE "public"."group_membership" TO "authenticated";
GRANT ALL ON TABLE "public"."group_membership" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."learning_objectives" TO "anon";
GRANT ALL ON TABLE "public"."learning_objectives" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_objectives" TO "service_role";



GRANT ALL ON TABLE "public"."lesson_assignments" TO "anon";
GRANT ALL ON TABLE "public"."lesson_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."lesson_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."lesson_links" TO "anon";
GRANT ALL ON TABLE "public"."lesson_links" TO "authenticated";
GRANT ALL ON TABLE "public"."lesson_links" TO "service_role";



GRANT ALL ON TABLE "public"."lesson_success_criteria" TO "anon";
GRANT ALL ON TABLE "public"."lesson_success_criteria" TO "authenticated";
GRANT ALL ON TABLE "public"."lesson_success_criteria" TO "service_role";



GRANT ALL ON TABLE "public"."lessons" TO "anon";
GRANT ALL ON TABLE "public"."lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."lessons" TO "service_role";



GRANT ALL ON TABLE "public"."lessons_learning_objective" TO "anon";
GRANT ALL ON TABLE "public"."lessons_learning_objective" TO "authenticated";
GRANT ALL ON TABLE "public"."lessons_learning_objective" TO "service_role";



GRANT ALL ON TABLE "public"."n8n_chat_histories" TO "anon";
GRANT ALL ON TABLE "public"."n8n_chat_histories" TO "authenticated";
GRANT ALL ON TABLE "public"."n8n_chat_histories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."n8n_chat_histories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."n8n_chat_histories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."n8n_chat_histories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."report_pupil_cache" TO "anon";
GRANT ALL ON TABLE "public"."report_pupil_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."report_pupil_cache" TO "service_role";



GRANT ALL ON TABLE "public"."report_pupil_feedback_cache" TO "anon";
GRANT ALL ON TABLE "public"."report_pupil_feedback_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."report_pupil_feedback_cache" TO "service_role";



GRANT ALL ON TABLE "public"."report_pupil_unit_summaries" TO "anon";
GRANT ALL ON TABLE "public"."report_pupil_unit_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."report_pupil_unit_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."short_text_feedback_events" TO "anon";
GRANT ALL ON TABLE "public"."short_text_feedback_events" TO "authenticated";
GRANT ALL ON TABLE "public"."short_text_feedback_events" TO "service_role";



GRANT ALL ON TABLE "public"."subjects" TO "anon";
GRANT ALL ON TABLE "public"."subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."subjects" TO "service_role";



GRANT ALL ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."submissions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."submissions_replication_pk_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."submissions_replication_pk_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."submissions_replication_pk_seq" TO "service_role";



GRANT ALL ON TABLE "public"."success_criteria" TO "anon";
GRANT ALL ON TABLE "public"."success_criteria" TO "authenticated";
GRANT ALL ON TABLE "public"."success_criteria" TO "service_role";



GRANT ALL ON TABLE "public"."success_criteria_units" TO "anon";
GRANT ALL ON TABLE "public"."success_criteria_units" TO "authenticated";
GRANT ALL ON TABLE "public"."success_criteria_units" TO "service_role";



GRANT ALL ON TABLE "public"."units" TO "anon";
GRANT ALL ON TABLE "public"."units" TO "authenticated";
GRANT ALL ON TABLE "public"."units" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



























