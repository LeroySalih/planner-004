-- Score "upload-worksheet" activities the same way as "upload-spreadsheet"/short-text-question:
-- read ai_model_score (AI marking), falling back to score/auto_score. Without this, AI-marked
-- worksheet submissions show no score anywhere in the app.

CREATE OR REPLACE FUNCTION public.compute_submission_base_score(body jsonb, activity_type text) RETURNS numeric
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

  if normalized_type = 'multiple-choice-question' or normalized_type = 'matcher' then
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
  elsif normalized_type = 'short-text-question' or normalized_type = 'upload-spreadsheet' or normalized_type = 'upload-worksheet' then
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
