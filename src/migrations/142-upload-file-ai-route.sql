-- 142-upload-file-ai-route.sql
--
-- An upload-file activity can now be marked by AI when its "Mark with AI"
-- switch is on (body_data.aiMarking). It is routed like the other AI-marked
-- types at /admin/ai-models. Without a row it would fall through to
-- DEFAULT_ROUTE, a Gemini model that is geo-blocked where the app is hosted,
-- so it starts on the same provider and model as upload-code, the other
-- marked upload type, or on Claude Sonnet 5 when that has no route. No
-- existing route is changed.

BEGIN;

INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'upload-file', NULL,
       coalesce(r.provider, 'anthropic'), coalesce(r.model, 'claude-sonnet-5'), r.effort, 'migration-142'
  FROM (SELECT 1) one
  LEFT JOIN ai_model_routes r ON r.activity_type = 'upload-code' AND r.sc_type IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM ai_model_routes
                    WHERE activity_type = 'upload-file' AND sc_type IS NULL);

COMMIT;
