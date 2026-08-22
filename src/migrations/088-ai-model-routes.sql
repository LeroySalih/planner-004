-- 088-ai-model-routes.sql
--
-- Choose which model marks which activity, from the admin UI rather than from
-- a redeployed constant.
--
-- Until now every marking call used defaultMarkingModel() — one model for
-- everything, overridable only by the GEMINI_MARKING_MODEL environment
-- variable. That is the wrong granularity in both directions: a binary 0/1
-- criterion does not need the same model as a levelled 0..n one, and a
-- worksheet photo needs a high-resolution vision model that a short-text
-- question does not.
--
-- Routes are keyed on (activity_type, sc_type) because per-criterion marking
-- already assesses those two cases separately (see aggregate-sc-marks.ts).
-- A row with sc_type NULL is the activity-wide default; a row with sc_type set
-- overrides it for criteria of that type only.
--
-- API keys are deliberately NOT stored here. They stay in .env, per the
-- security policy in CLAUDE.md — this table holds routing choices only.
--
-- Requires 087-school-year-current.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_model_routes (
  route_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type text NOT NULL,
  -- NULL = the default for every criterion of this activity type.
  sc_type       text,
  provider      text NOT NULL,
  model         text NOT NULL,
  -- Reasoning depth. Anthropic-only; ignored for google rows, which have no
  -- equivalent parameter. NULL means "provider default".
  effort        text,
  active        boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,

  CONSTRAINT ai_model_routes_sc_type_check
    CHECK (sc_type IS NULL OR sc_type IN ('binary', 'levelled')),
  CONSTRAINT ai_model_routes_provider_check
    CHECK (provider IN ('google', 'anthropic')),
  CONSTRAINT ai_model_routes_effort_check
    CHECK (effort IS NULL OR effort IN ('low', 'medium', 'high', 'xhigh', 'max'))
);

-- Two partial indexes rather than one composite unique: NULL is never equal to
-- NULL in a unique index, so a plain UNIQUE (activity_type, sc_type) would
-- happily accept several competing activity-wide defaults for the same type.
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_routes_type_sc_key
  ON public.ai_model_routes (activity_type, sc_type)
  WHERE sc_type IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_model_routes_type_default_key
  ON public.ai_model_routes (activity_type)
  WHERE sc_type IS NULL;

COMMENT ON TABLE public.ai_model_routes IS
  'Which model marks which activity. Keyed on (activity_type, sc_type); a NULL sc_type row is the activity-wide default. Resolution order is (activity_type, sc_type) -> (activity_type, NULL) -> the hardcoded fallback in model-routing.ts. Contains no credentials.';

COMMENT ON COLUMN public.ai_model_routes.effort IS
  'Anthropic reasoning effort (low|medium|high|xhigh|max). Ignored for provider = google.';

-- Seed the AI-marked types with what they already use, so applying this
-- migration changes no behaviour. These are the types listed in the AI branch
-- of compute_submission_base_score (see 086-upload-code-activity-score.sql).
INSERT INTO public.ai_model_routes (activity_type, sc_type, provider, model, effort)
SELECT t.activity_type, NULL, 'google', 'gemini-flash-latest', NULL
FROM (VALUES
  ('short-text-question'),
  ('upload-code'),
  ('upload-worksheet'),
  ('mark-worksheet'),
  ('upload-spreadsheet')
) AS t(activity_type)
ON CONFLICT DO NOTHING;

COMMIT;
