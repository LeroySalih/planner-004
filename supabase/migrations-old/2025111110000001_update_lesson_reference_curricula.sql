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
  WITH lesson_context AS (
    SELECT l.lesson_id, l.unit_id, u.subject
    FROM lessons l
    LEFT JOIN units u ON u.unit_id = l.unit_id
    WHERE l.lesson_id = p_lesson_id
  ),
  curriculum_ids AS (
    -- include curricula explicitly connected to the lesson via assessment objectives
    SELECT DISTINCT ao.curriculum_id
    FROM assessment_objectives ao
    JOIN lesson_context lc ON lc.unit_id = ao.unit_id
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

    UNION

    -- fall back to subject match to avoid missing unit-less curricula (e.g., KS3 templates)
    SELECT DISTINCT c.curriculum_id
    FROM curricula c
    JOIN lesson_context lc ON lc.subject IS NOT NULL AND c.subject IS NOT NULL AND c.subject = lc.subject
    WHERE c.curriculum_id IS NOT NULL
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
