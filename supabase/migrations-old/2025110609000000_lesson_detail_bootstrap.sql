-- Consolidated lesson detail + reference RPCs

DROP FUNCTION IF EXISTS public.lesson_detail_bootstrap(text);

CREATE OR REPLACE FUNCTION public.lesson_detail_bootstrap(p_lesson_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
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
$function$;


DROP FUNCTION IF EXISTS public.lesson_reference_bootstrap(text);

CREATE OR REPLACE FUNCTION public.lesson_reference_bootstrap(p_lesson_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH target_lesson AS (
    SELECT lesson_id, unit_id
    FROM lessons
    WHERE lesson_id = p_lesson_id
  ),
  curriculum_ids AS (
    SELECT DISTINCT ao.curriculum_id
    FROM assessment_objectives ao
    JOIN target_lesson tl ON tl.unit_id = ao.unit_id
    WHERE ao.curriculum_id IS NOT NULL
    UNION
    SELECT DISTINCT ao.curriculum_id
    FROM lessons_learning_objective llo
    JOIN learning_objectives lo ON lo.learning_objective_id = llo.learning_objective_id
    JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
    WHERE llo.lesson_id = p_lesson_id AND ao.curriculum_id IS NOT NULL
    UNION
    SELECT DISTINCT ao.curriculum_id
    FROM lesson_success_criteria lsc
    JOIN success_criteria sc ON sc.success_criteria_id = lsc.success_criteria_id
    JOIN learning_objectives lo ON lo.learning_objective_id = sc.learning_objective_id
    JOIN assessment_objectives ao ON ao.assessment_objective_id = lo.assessment_objective_id
    WHERE lsc.lesson_id = p_lesson_id AND ao.curriculum_id IS NOT NULL
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
$function$;
