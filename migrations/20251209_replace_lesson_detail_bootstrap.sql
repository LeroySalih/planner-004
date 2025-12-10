-- Update lesson_detail_bootstrap to read lesson files from stored_files (not storage.objects)
DROP FUNCTION IF EXISTS public.lesson_detail_bootstrap(text);

CREATE OR REPLACE FUNCTION public.lesson_detail_bootstrap(p_lesson_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
$function$;
