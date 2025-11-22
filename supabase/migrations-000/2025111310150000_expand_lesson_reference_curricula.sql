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
$function$;
