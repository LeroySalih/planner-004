--
-- PostgreSQL database dump
--

\restrict FPCbMT5WNQhB9wQcwsBLKHoPW1UgE6vy5l1WKRvhyA2SquI8rlWEDYzSAZ7QmwG

-- Dumped from database version 17.7 (Debian 17.7-3.pgdg12+1)
-- Dumped by pg_dump version 17.7 (Debian 17.7-3.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA extensions;


ALTER SCHEMA extensions OWNER TO postgres;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: assignments_bootstrap(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.assignments_bootstrap() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


ALTER FUNCTION public.assignments_bootstrap() OWNER TO postgres;

--
-- Name: clamp_score(numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clamp_score(score numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when score is null then null
    when score < 0 then 0::numeric
    when score > 1 then 1::numeric
    else score
  end;
$$;


ALTER FUNCTION public.clamp_score(score numeric) OWNER TO postgres;

--
-- Name: compute_submission_base_score(json, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.compute_submission_base_score(body json, activity_type text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  select compute_submission_base_score(body::jsonb, activity_type);
$$;


ALTER FUNCTION public.compute_submission_base_score(body json, activity_type text) OWNER TO postgres;

--
-- Name: compute_submission_base_score(jsonb, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.compute_submission_base_score(body jsonb, activity_type text) RETURNS numeric
    LANGUAGE plpgsql STABLE
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


ALTER FUNCTION public.compute_submission_base_score(body jsonb, activity_type text) OWNER TO postgres;

--
-- Name: get_latest_short_text_submission(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_latest_short_text_submission(p_activity_id text, p_pupil_id text) RETURNS TABLE(submission_id text, activity_id text, lesson_id text, activity_question text, activity_model_answer text, pupil_answer text, submitted_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


ALTER FUNCTION public.get_latest_short_text_submission(p_activity_id text, p_pupil_id text) OWNER TO postgres;

--
-- Name: lesson_assignment_score_summaries(jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lesson_assignment_score_summaries(pairs jsonb) RETURNS TABLE(group_id text, lesson_id text, activities_average numeric)
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


ALTER FUNCTION public.lesson_assignment_score_summaries(pairs jsonb) OWNER TO postgres;

--
-- Name: lesson_detail_bootstrap(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lesson_detail_bootstrap(p_lesson_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


ALTER FUNCTION public.lesson_detail_bootstrap(p_lesson_id text) OWNER TO postgres;

--
-- Name: lesson_reference_bootstrap(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lesson_reference_bootstrap(p_lesson_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


ALTER FUNCTION public.lesson_reference_bootstrap(p_lesson_id text) OWNER TO postgres;

--
-- Name: match_documents(extensions.vector, integer, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.match_documents(query_embedding extensions.vector, match_count integer DEFAULT 10, filter jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(id bigint, content text, metadata jsonb, similarity double precision)
    LANGUAGE sql STABLE
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


ALTER FUNCTION public.match_documents(query_embedding extensions.vector, match_count integer, filter jsonb) OWNER TO postgres;

--
-- Name: pupil_lessons_detail_bootstrap(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pupil_lessons_detail_bootstrap(p_target_user_id text) RETURNS jsonb
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


ALTER FUNCTION public.pupil_lessons_detail_bootstrap(p_target_user_id text) OWNER TO postgres;

--
-- Name: pupil_lessons_summary_bootstrap(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pupil_lessons_summary_bootstrap(p_target_user_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


ALTER FUNCTION public.pupil_lessons_summary_bootstrap(p_target_user_id text) OWNER TO postgres;

--
-- Name: reports_get_prepared_report_dataset(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reports_get_prepared_report_dataset(p_pupil_id text, p_group_id text DEFAULT NULL::text) RETURNS jsonb
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


ALTER FUNCTION public.reports_get_prepared_report_dataset(p_pupil_id text, p_group_id text) OWNER TO postgres;

--
-- Name: reports_list_pupils_with_groups(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reports_list_pupils_with_groups() RETURNS jsonb
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


ALTER FUNCTION public.reports_list_pupils_with_groups() OWNER TO postgres;

--
-- Name: reports_recalculate_pupil_cache(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reports_recalculate_pupil_cache(p_pupil_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


ALTER FUNCTION public.reports_recalculate_pupil_cache(p_pupil_id text) OWNER TO postgres;

--
-- Name: reports_store_pupil_unit_summaries(text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reports_store_pupil_unit_summaries(p_pupil_id text, p_units jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


ALTER FUNCTION public.reports_store_pupil_unit_summaries(p_pupil_id text, p_units jsonb) OWNER TO postgres;

--
-- Name: safe_numeric(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.safe_numeric(value text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
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


ALTER FUNCTION public.safe_numeric(value text) OWNER TO postgres;

--
-- Name: set_learning_objectives_order_by(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_learning_objectives_order_by() RETURNS trigger
    LANGUAGE plpgsql
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


ALTER FUNCTION public.set_learning_objectives_order_by() OWNER TO postgres;

--
-- Name: set_lessons_order_by(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_lessons_order_by() RETURNS trigger
    LANGUAGE plpgsql
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


ALTER FUNCTION public.set_lessons_order_by() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activities (
    activity_id text DEFAULT gen_random_uuid() NOT NULL,
    lesson_id text,
    title text,
    type text,
    body_data jsonb,
    is_homework boolean DEFAULT false,
    order_by integer,
    active boolean DEFAULT true,
    is_summative boolean DEFAULT false,
    notes text
);


ALTER TABLE public.activities OWNER TO postgres;

--
-- Name: activity_submission_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_submission_events (
    activity_submission_event_id text DEFAULT gen_random_uuid() NOT NULL,
    submission_id text,
    activity_id text NOT NULL,
    lesson_id text NOT NULL,
    pupil_id text NOT NULL,
    file_name text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.activity_submission_events OWNER TO postgres;

--
-- Name: activity_success_criteria; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_success_criteria (
    activity_id text NOT NULL,
    success_criteria_id text NOT NULL
);


ALTER TABLE public.activity_success_criteria OWNER TO postgres;

--
-- Name: assessment_objectives; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_objectives (
    assessment_objective_id text DEFAULT gen_random_uuid() NOT NULL,
    curriculum_id text,
    unit_id text,
    code text NOT NULL,
    title text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.assessment_objectives OWNER TO postgres;

--
-- Name: assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assignments (
    group_id text NOT NULL,
    unit_id text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    active boolean DEFAULT true
);


ALTER TABLE public.assignments OWNER TO postgres;

--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_sessions (
    session_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip text,
    user_agent text
);


ALTER TABLE public.auth_sessions OWNER TO postgres;

--
-- Name: curricula; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.curricula (
    curriculum_id text DEFAULT gen_random_uuid() NOT NULL,
    subject text,
    title text NOT NULL,
    description text,
    active boolean DEFAULT true
);


ALTER TABLE public.curricula OWNER TO postgres;

--
-- Name: documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.documents (
    id bigint NOT NULL,
    content text,
    metadata jsonb,
    embedding extensions.vector(768)
);


ALTER TABLE public.documents OWNER TO postgres;

--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.documents_id_seq OWNER TO postgres;

--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.feedback (
    id integer NOT NULL,
    user_id text NOT NULL,
    lesson_id text NOT NULL,
    success_criteria_id text NOT NULL,
    rating integer NOT NULL
);


ALTER TABLE public.feedback OWNER TO postgres;

--
-- Name: feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.feedback_id_seq OWNER TO postgres;

--
-- Name: feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.feedback_id_seq OWNED BY public.feedback.id;


--
-- Name: group_membership; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.group_membership (
    group_id text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL
);


ALTER TABLE public.group_membership OWNER TO postgres;

--
-- Name: groups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.groups (
    group_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    join_code text,
    subject text,
    active boolean DEFAULT true
);


ALTER TABLE public.groups OWNER TO postgres;

--
-- Name: learning_objectives; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_objectives (
    learning_objective_id text DEFAULT gen_random_uuid() NOT NULL,
    assessment_objective_id text NOT NULL,
    title text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    spec_ref text
);


ALTER TABLE public.learning_objectives OWNER TO postgres;

--
-- Name: lesson_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson_assignments (
    group_id text NOT NULL,
    lesson_id text NOT NULL,
    start_date date NOT NULL,
    feedback_visible boolean DEFAULT false NOT NULL
);


ALTER TABLE public.lesson_assignments OWNER TO postgres;

--
-- Name: lesson_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson_links (
    lesson_link_id text DEFAULT gen_random_uuid() NOT NULL,
    lesson_id text,
    url text NOT NULL,
    description text
);


ALTER TABLE public.lesson_links OWNER TO postgres;

--
-- Name: lesson_success_criteria; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson_success_criteria (
    lesson_id text NOT NULL,
    success_criteria_id text NOT NULL
);


ALTER TABLE public.lesson_success_criteria OWNER TO postgres;

--
-- Name: lessons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lessons (
    lesson_id text DEFAULT gen_random_uuid() NOT NULL,
    unit_id text NOT NULL,
    title text NOT NULL,
    active boolean DEFAULT true,
    order_by integer NOT NULL
);


ALTER TABLE public.lessons OWNER TO postgres;

--
-- Name: lessons_learning_objective; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lessons_learning_objective (
    learning_objective_id text NOT NULL,
    lesson_id text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    active boolean DEFAULT true,
    order_by integer NOT NULL
);


ALTER TABLE public.lessons_learning_objective OWNER TO postgres;

--
-- Name: n8n_chat_histories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.n8n_chat_histories (
    id integer NOT NULL,
    session_id character varying(255) NOT NULL,
    message jsonb NOT NULL
);


ALTER TABLE public.n8n_chat_histories OWNER TO postgres;

--
-- Name: n8n_chat_histories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.n8n_chat_histories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.n8n_chat_histories_id_seq OWNER TO postgres;

--
-- Name: n8n_chat_histories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.n8n_chat_histories_id_seq OWNED BY public.n8n_chat_histories.id;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.profiles (
    user_id text NOT NULL,
    first_name text,
    last_name text,
    is_teacher boolean DEFAULT false,
    email text,
    password_hash text DEFAULT '$2b$10$8d6pphvMCMKlYXPklQs6iuZgq8MIHJYBPK3l9c5czgpLTsdBMxnmW'::text NOT NULL
);


ALTER TABLE public.profiles OWNER TO postgres;

--
-- Name: pupil_activity_feedback; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pupil_activity_feedback (
    feedback_id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id text NOT NULL,
    pupil_id text NOT NULL,
    submission_id text,
    source text NOT NULL,
    score numeric,
    feedback_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    CONSTRAINT pupil_activity_feedback_score_range CHECK (((score IS NULL) OR ((score >= (0)::numeric) AND (score <= (1)::numeric)))),
    CONSTRAINT pupil_activity_feedback_source_check CHECK ((source = ANY (ARRAY['teacher'::text, 'auto'::text, 'ai'::text])))
);


ALTER TABLE public.pupil_activity_feedback OWNER TO postgres;

--
-- Name: pupil_sign_in_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pupil_sign_in_history (
    pupil_sign_in_history_id text DEFAULT gen_random_uuid() NOT NULL,
    pupil_id text NOT NULL,
    url text NOT NULL,
    signed_in_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.pupil_sign_in_history OWNER TO postgres;

--
-- Name: report_pupil_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_pupil_cache (
    pupil_id text NOT NULL,
    dataset jsonb NOT NULL,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.report_pupil_cache OWNER TO postgres;

--
-- Name: TABLE report_pupil_cache; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.report_pupil_cache IS 'Precomputed per-pupil report dataset payloads powering /reports views.';


--
-- Name: COLUMN report_pupil_cache.dataset; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.report_pupil_cache.dataset IS 'Full dataset as returned by reports_get_prepared_report_dataset.';


--
-- Name: report_pupil_feedback_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_pupil_feedback_cache (
    pupil_id text NOT NULL,
    success_criteria_id text NOT NULL,
    latest_feedback_id bigint NOT NULL,
    latest_rating integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.report_pupil_feedback_cache OWNER TO postgres;

--
-- Name: TABLE report_pupil_feedback_cache; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.report_pupil_feedback_cache IS 'Latest feedback/rating snapshot per pupil and success criterion for group-level aggregations.';


--
-- Name: report_pupil_unit_summaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_pupil_unit_summaries (
    pupil_id text NOT NULL,
    unit_id text NOT NULL,
    unit_title text,
    unit_subject text,
    unit_description text,
    unit_year integer,
    related_group_ids text[] DEFAULT '{}'::text[] NOT NULL,
    grouped_levels jsonb DEFAULT '[]'::jsonb NOT NULL,
    working_level integer,
    activities_average double precision,
    assessment_average double precision,
    assessment_level text,
    score_error text,
    objective_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.report_pupil_unit_summaries OWNER TO postgres;

--
-- Name: short_text_feedback_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.short_text_feedback_events (
    feedback_event_id text DEFAULT gen_random_uuid() NOT NULL,
    assignment_id text,
    lesson_id text,
    activity_id text NOT NULL,
    submission_id text,
    pupil_id text NOT NULL,
    activity_question text,
    activity_model_answer text,
    pupil_answer text,
    ai_score numeric,
    ai_feedback text,
    request_context jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


ALTER TABLE public.short_text_feedback_events OWNER TO postgres;

--
-- Name: sign_in_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sign_in_attempts (
    sign_in_attempt_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    ip text,
    user_id text,
    success boolean NOT NULL,
    reason text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sign_in_attempts OWNER TO postgres;

--
-- Name: sse_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sse_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic text NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    emitted_by text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


ALTER TABLE public.sse_events OWNER TO postgres;

--
-- Name: stored_files; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stored_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket text NOT NULL,
    scope_path text NOT NULL,
    file_name text NOT NULL,
    stored_path text NOT NULL,
    content_type text,
    size_bytes bigint,
    checksum text,
    uploaded_by text,
    original_path text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


ALTER TABLE public.stored_files OWNER TO postgres;

--
-- Name: subjects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subjects (
    subject text NOT NULL,
    active boolean DEFAULT true
);


ALTER TABLE public.subjects OWNER TO postgres;

--
-- Name: submissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.submissions (
    submission_id text DEFAULT gen_random_uuid() NOT NULL,
    activity_id text NOT NULL,
    user_id text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now(),
    body json,
    replication_pk bigint NOT NULL,
    submission_status text DEFAULT 'inprogress'::text NOT NULL,
    CONSTRAINT submissions_submission_status_check CHECK ((submission_status = ANY (ARRAY['inprogress'::text, 'submitted'::text, 'completed'::text, 'rejected'::text])))
);

ALTER TABLE ONLY public.submissions REPLICA IDENTITY FULL;


ALTER TABLE public.submissions OWNER TO postgres;

--
-- Name: submissions_replication_pk_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.submissions_replication_pk_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.submissions_replication_pk_seq OWNER TO postgres;

--
-- Name: submissions_replication_pk_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.submissions_replication_pk_seq OWNED BY public.submissions.replication_pk;


--
-- Name: success_criteria; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.success_criteria (
    success_criteria_id text DEFAULT gen_random_uuid() NOT NULL,
    learning_objective_id text NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    description text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true
);


ALTER TABLE public.success_criteria OWNER TO postgres;

--
-- Name: success_criteria_units; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.success_criteria_units (
    success_criteria_id text NOT NULL,
    unit_id text NOT NULL
);


ALTER TABLE public.success_criteria_units OWNER TO postgres;

--
-- Name: units; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.units (
    unit_id text DEFAULT gen_random_uuid() NOT NULL,
    title text,
    subject text NOT NULL,
    active boolean DEFAULT true,
    description character varying,
    year integer
);


ALTER TABLE public.units OWNER TO postgres;

--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: feedback id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.feedback ALTER COLUMN id SET DEFAULT nextval('public.feedback_id_seq'::regclass);


--
-- Name: n8n_chat_histories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.n8n_chat_histories ALTER COLUMN id SET DEFAULT nextval('public.n8n_chat_histories_id_seq'::regclass);


--
-- Name: submissions replication_pk; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submissions ALTER COLUMN replication_pk SET DEFAULT nextval('public.submissions_replication_pk_seq'::regclass);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (activity_id);


--
-- Name: activity_submission_events activity_submission_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_submission_events
    ADD CONSTRAINT activity_submission_events_pkey PRIMARY KEY (activity_submission_event_id);


--
-- Name: activity_success_criteria activity_success_criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_success_criteria
    ADD CONSTRAINT activity_success_criteria_pkey PRIMARY KEY (activity_id, success_criteria_id);


--
-- Name: assessment_objectives assessment_objectives_curriculum_id_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_objectives
    ADD CONSTRAINT assessment_objectives_curriculum_id_code_key UNIQUE (curriculum_id, code);


--
-- Name: assessment_objectives assessment_objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_objectives
    ADD CONSTRAINT assessment_objectives_pkey PRIMARY KEY (assessment_objective_id);


--
-- Name: assessment_objectives assessment_objectives_unit_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_objectives
    ADD CONSTRAINT assessment_objectives_unit_id_key UNIQUE (unit_id);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (group_id, unit_id, start_date);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: curricula curricula_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curricula
    ADD CONSTRAINT curricula_pkey PRIMARY KEY (curriculum_id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (group_id);


--
-- Name: learning_objectives learning_objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_objectives
    ADD CONSTRAINT learning_objectives_pkey PRIMARY KEY (learning_objective_id);


--
-- Name: lesson_assignments lesson_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_assignments
    ADD CONSTRAINT lesson_assignments_pkey PRIMARY KEY (group_id, lesson_id, start_date);


--
-- Name: lesson_links lesson_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_links
    ADD CONSTRAINT lesson_links_pkey PRIMARY KEY (lesson_link_id);


--
-- Name: lesson_success_criteria lesson_success_criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_success_criteria
    ADD CONSTRAINT lesson_success_criteria_pkey PRIMARY KEY (lesson_id, success_criteria_id);


--
-- Name: lessons_learning_objective lessons_learning_objective_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lessons_learning_objective
    ADD CONSTRAINT lessons_learning_objective_pkey PRIMARY KEY (learning_objective_id, lesson_id);


--
-- Name: lessons lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_pkey PRIMARY KEY (lesson_id);


--
-- Name: n8n_chat_histories n8n_chat_histories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.n8n_chat_histories
    ADD CONSTRAINT n8n_chat_histories_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: pupil_activity_feedback pupil_activity_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pupil_activity_feedback
    ADD CONSTRAINT pupil_activity_feedback_pkey PRIMARY KEY (feedback_id);


--
-- Name: report_pupil_cache report_pupil_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_pupil_cache
    ADD CONSTRAINT report_pupil_cache_pkey PRIMARY KEY (pupil_id);


--
-- Name: report_pupil_feedback_cache report_pupil_feedback_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_pupil_feedback_cache
    ADD CONSTRAINT report_pupil_feedback_cache_pkey PRIMARY KEY (pupil_id, success_criteria_id);


--
-- Name: report_pupil_unit_summaries report_pupil_unit_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_pupil_unit_summaries
    ADD CONSTRAINT report_pupil_unit_summaries_pkey PRIMARY KEY (pupil_id, unit_id);


--
-- Name: short_text_feedback_events short_text_feedback_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.short_text_feedback_events
    ADD CONSTRAINT short_text_feedback_events_pkey PRIMARY KEY (feedback_event_id);


--
-- Name: sign_in_attempts sign_in_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sign_in_attempts
    ADD CONSTRAINT sign_in_attempts_pkey PRIMARY KEY (sign_in_attempt_id);


--
-- Name: sse_events sse_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sse_events
    ADD CONSTRAINT sse_events_pkey PRIMARY KEY (id);


--
-- Name: stored_files stored_files_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stored_files
    ADD CONSTRAINT stored_files_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (subject);


--
-- Name: submissions submissions_replication_pk_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_replication_pk_pkey PRIMARY KEY (replication_pk);


--
-- Name: success_criteria success_criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.success_criteria
    ADD CONSTRAINT success_criteria_pkey PRIMARY KEY (success_criteria_id);


--
-- Name: success_criteria_units success_criteria_units_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.success_criteria_units
    ADD CONSTRAINT success_criteria_units_pkey PRIMARY KEY (success_criteria_id, unit_id);


--
-- Name: units units_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (unit_id);


--
-- Name: assessment_objectives_curriculum_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assessment_objectives_curriculum_id_idx ON public.assessment_objectives USING btree (curriculum_id);


--
-- Name: auth_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_sessions_expires_at_idx ON public.auth_sessions USING btree (expires_at);


--
-- Name: auth_sessions_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_sessions_user_id_idx ON public.auth_sessions USING btree (user_id);


--
-- Name: documents_embedding_hnsw; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX documents_embedding_hnsw ON public.documents USING hnsw (embedding extensions.vector_cosine_ops);


--
-- Name: feedback_unique_user_lesson_criterion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX feedback_unique_user_lesson_criterion ON public.feedback USING btree (user_id, lesson_id, success_criteria_id);


--
-- Name: idx_activities_lesson_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activities_lesson_order ON public.activities USING btree (lesson_id, order_by, activity_id);


--
-- Name: idx_activity_submission_events_activity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_submission_events_activity ON public.activity_submission_events USING btree (activity_id);


--
-- Name: idx_activity_submission_events_pupil; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_submission_events_pupil ON public.activity_submission_events USING btree (pupil_id);


--
-- Name: idx_activity_submission_events_submitted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_submission_events_submitted_at ON public.activity_submission_events USING btree (submitted_at DESC);


--
-- Name: idx_activity_success_criteria_success_activity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_success_criteria_success_activity ON public.activity_success_criteria USING btree (success_criteria_id, activity_id);


--
-- Name: idx_feedback_lesson_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_feedback_lesson_user ON public.feedback USING btree (lesson_id, user_id);


--
-- Name: idx_group_membership_group_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_group_membership_group_user ON public.group_membership USING btree (group_id, user_id);


--
-- Name: idx_group_membership_user_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_group_membership_user_group ON public.group_membership USING btree (user_id, group_id);


--
-- Name: idx_groups_join_code_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_groups_join_code_unique ON public.groups USING btree (join_code) WHERE (join_code IS NOT NULL);


--
-- Name: idx_lesson_assignments_lesson_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lesson_assignments_lesson_group ON public.lesson_assignments USING btree (lesson_id, group_id, start_date);


--
-- Name: idx_lesson_links_lesson; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lesson_links_lesson ON public.lesson_links USING btree (lesson_id, lesson_link_id);


--
-- Name: idx_lessons_learning_objective_lesson_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lessons_learning_objective_lesson_order ON public.lessons_learning_objective USING btree (lesson_id, order_by, learning_objective_id);


--
-- Name: idx_lessons_unit_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lessons_unit_order ON public.lessons USING btree (unit_id, order_by, lesson_id);


--
-- Name: idx_report_pupil_feedback_cache_criteria; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_pupil_feedback_cache_criteria ON public.report_pupil_feedback_cache USING btree (success_criteria_id, pupil_id);


--
-- Name: idx_report_pupil_unit_summaries_group_ids; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_pupil_unit_summaries_group_ids ON public.report_pupil_unit_summaries USING gin (related_group_ids);


--
-- Name: idx_report_pupil_unit_summaries_pupil_subject; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_pupil_unit_summaries_pupil_subject ON public.report_pupil_unit_summaries USING btree (pupil_id, unit_subject);


--
-- Name: idx_report_pupil_unit_summaries_subject; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_pupil_unit_summaries_subject ON public.report_pupil_unit_summaries USING btree (unit_subject);


--
-- Name: idx_submissions_activity_submitted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_submissions_activity_submitted ON public.submissions USING btree (activity_id, submitted_at DESC, submission_id);


--
-- Name: idx_submissions_activity_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_submissions_activity_user ON public.submissions USING btree (activity_id, user_id);


--
-- Name: idx_submissions_submission_id_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_submissions_submission_id_unique ON public.submissions USING btree (submission_id);


--
-- Name: idx_success_criteria_units_unit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_success_criteria_units_unit ON public.success_criteria_units USING btree (unit_id, success_criteria_id);


--
-- Name: learning_objectives_assessment_objective_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX learning_objectives_assessment_objective_id_idx ON public.learning_objectives USING btree (assessment_objective_id, order_index);


--
-- Name: profiles_email_ci_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX profiles_email_ci_idx ON public.profiles USING btree (lower(email)) WHERE (email IS NOT NULL);


--
-- Name: short_text_feedback_events_activity_pupil_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX short_text_feedback_events_activity_pupil_idx ON public.short_text_feedback_events USING btree (activity_id, pupil_id);


--
-- Name: short_text_feedback_events_assignment_pupil_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX short_text_feedback_events_assignment_pupil_idx ON public.short_text_feedback_events USING btree (assignment_id, pupil_id);


--
-- Name: sign_in_attempts_attempted_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sign_in_attempts_attempted_at_idx ON public.sign_in_attempts USING btree (attempted_at DESC);


--
-- Name: sign_in_attempts_email_attempted_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sign_in_attempts_email_attempted_at_idx ON public.sign_in_attempts USING btree (email, attempted_at DESC);


--
-- Name: sign_in_attempts_ip_attempted_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sign_in_attempts_ip_attempted_at_idx ON public.sign_in_attempts USING btree (ip, attempted_at DESC);


--
-- Name: sse_events_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sse_events_created_idx ON public.sse_events USING btree (created_at DESC);


--
-- Name: sse_events_topic_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sse_events_topic_created_idx ON public.sse_events USING btree (topic, created_at DESC);


--
-- Name: stored_files_bucket_scope_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX stored_files_bucket_scope_idx ON public.stored_files USING btree (bucket, scope_path);


--
-- Name: stored_files_bucket_scope_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX stored_files_bucket_scope_name_idx ON public.stored_files USING btree (bucket, scope_path, file_name);


--
-- Name: success_criteria_learning_objective_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX success_criteria_learning_objective_idx ON public.success_criteria USING btree (learning_objective_id, order_index);


--
-- Name: lessons trg_set_lessons_order_by; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_set_lessons_order_by BEFORE INSERT ON public.lessons FOR EACH ROW EXECUTE FUNCTION public.set_lessons_order_by();


--
-- Name: activities activities_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(lesson_id);


--
-- Name: assessment_objectives assessment_objectives_curriculum_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_objectives
    ADD CONSTRAINT assessment_objectives_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES public.curricula(curriculum_id) ON DELETE CASCADE;


--
-- Name: assessment_objectives assessment_objectives_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_objectives
    ADD CONSTRAINT assessment_objectives_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(unit_id) ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: curricula curricula_subject_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.curricula
    ADD CONSTRAINT curricula_subject_fkey FOREIGN KEY (subject) REFERENCES public.subjects(subject) ON DELETE SET NULL;


--
-- Name: group_membership group_membership_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_membership
    ADD CONSTRAINT group_membership_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(group_id) ON DELETE CASCADE;


--
-- Name: learning_objectives learning_objectives_assessment_objective_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_objectives
    ADD CONSTRAINT learning_objectives_assessment_objective_id_fkey FOREIGN KEY (assessment_objective_id) REFERENCES public.assessment_objectives(assessment_objective_id) ON DELETE CASCADE;


--
-- Name: lesson_links lesson_links_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_links
    ADD CONSTRAINT lesson_links_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(lesson_id) ON DELETE CASCADE;


--
-- Name: lessons_learning_objective lessons_learning_objective_learning_objective_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lessons_learning_objective
    ADD CONSTRAINT lessons_learning_objective_learning_objective_id_fkey FOREIGN KEY (learning_objective_id) REFERENCES public.learning_objectives(learning_objective_id) ON DELETE CASCADE;


--
-- Name: lessons_learning_objective lessons_learning_objective_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lessons_learning_objective
    ADD CONSTRAINT lessons_learning_objective_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(lesson_id) ON DELETE CASCADE;


--
-- Name: lessons lessons_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(unit_id) ON DELETE CASCADE;


--
-- Name: pupil_activity_feedback pupil_activity_feedback_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pupil_activity_feedback
    ADD CONSTRAINT pupil_activity_feedback_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(activity_id) ON DELETE CASCADE;


--
-- Name: pupil_activity_feedback pupil_activity_feedback_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pupil_activity_feedback
    ADD CONSTRAINT pupil_activity_feedback_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(user_id);


--
-- Name: pupil_activity_feedback pupil_activity_feedback_pupil_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pupil_activity_feedback
    ADD CONSTRAINT pupil_activity_feedback_pupil_id_fkey FOREIGN KEY (pupil_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: pupil_activity_feedback pupil_activity_feedback_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pupil_activity_feedback
    ADD CONSTRAINT pupil_activity_feedback_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(submission_id) ON DELETE SET NULL;


--
-- Name: pupil_sign_in_history pupil_sign_in_history_pupil_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pupil_sign_in_history
    ADD CONSTRAINT pupil_sign_in_history_pupil_id_fkey FOREIGN KEY (pupil_id) REFERENCES public.profiles(user_id);


--
-- Name: report_pupil_cache report_pupil_cache_pupil_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_pupil_cache
    ADD CONSTRAINT report_pupil_cache_pupil_id_fkey FOREIGN KEY (pupil_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: report_pupil_feedback_cache report_pupil_feedback_cache_pupil_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_pupil_feedback_cache
    ADD CONSTRAINT report_pupil_feedback_cache_pupil_id_fkey FOREIGN KEY (pupil_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: report_pupil_unit_summaries report_pupil_unit_summaries_pupil_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_pupil_unit_summaries
    ADD CONSTRAINT report_pupil_unit_summaries_pupil_id_fkey FOREIGN KEY (pupil_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: short_text_feedback_events short_text_feedback_events_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.short_text_feedback_events
    ADD CONSTRAINT short_text_feedback_events_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(activity_id) ON DELETE CASCADE;


--
-- Name: short_text_feedback_events short_text_feedback_events_pupil_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.short_text_feedback_events
    ADD CONSTRAINT short_text_feedback_events_pupil_id_fkey FOREIGN KEY (pupil_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: short_text_feedback_events short_text_feedback_events_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.short_text_feedback_events
    ADD CONSTRAINT short_text_feedback_events_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(submission_id) ON DELETE SET NULL;


--
-- Name: sign_in_attempts sign_in_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sign_in_attempts
    ADD CONSTRAINT sign_in_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: sse_events sse_events_emitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sse_events
    ADD CONSTRAINT sse_events_emitted_by_fkey FOREIGN KEY (emitted_by) REFERENCES public.profiles(user_id);


--
-- Name: success_criteria success_criteria_learning_objective_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.success_criteria
    ADD CONSTRAINT success_criteria_learning_objective_id_fkey FOREIGN KEY (learning_objective_id) REFERENCES public.learning_objectives(learning_objective_id) ON DELETE CASCADE;


--
-- Name: success_criteria_units success_criteria_units_success_criteria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.success_criteria_units
    ADD CONSTRAINT success_criteria_units_success_criteria_id_fkey FOREIGN KEY (success_criteria_id) REFERENCES public.success_criteria(success_criteria_id) ON DELETE CASCADE;


--
-- Name: success_criteria_units success_criteria_units_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.success_criteria_units
    ADD CONSTRAINT success_criteria_units_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(unit_id) ON DELETE CASCADE;


--
-- Name: units units_subject_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_subject_fkey FOREIGN KEY (subject) REFERENCES public.subjects(subject);


--
-- PostgreSQL database dump complete
--

\unrestrict FPCbMT5WNQhB9wQcwsBLKHoPW1UgE6vy5l1WKRvhyA2SquI8rlWEDYzSAZ7QmwG

