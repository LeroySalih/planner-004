-- 135-assessment-read-route.sql
--
-- Assessment paper marking v2 reads each script once before marking it per
-- question (docs/plans/2026-11-01-assessment-paper-activity.md, "Marking v2").
-- The read is its own model surface, `surface:assessment-read`, routed like
-- the others at /admin/ai-models. It starts on the same provider and model as
-- the paper's marking route, (assessment-paper, NULL), so the read and the
-- marks run on one model until someone chooses otherwise. No existing route
-- is changed.

BEGIN;

INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'surface:assessment-read', NULL,
       coalesce(r.provider, 'anthropic'), coalesce(r.model, 'claude-sonnet-5'), r.effort, 'migration-135'
  FROM (SELECT 1) one
  LEFT JOIN ai_model_routes r ON r.activity_type = 'assessment-paper' AND r.sc_type IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM ai_model_routes
                    WHERE activity_type = 'surface:assessment-read' AND sc_type IS NULL);

COMMIT;
