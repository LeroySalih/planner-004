-- 136-assessment-mark-scheme-route.sql
--
-- Assessment paper marking v2, step 6: a teacher can ask the model to split a
-- paper's mark scheme PDF into per-question text, which they review and save
-- (docs/plans/2026-11-01-assessment-paper-activity.md, "Marking v2" §5).
-- The split is its own model surface, `surface:assessment-mark-scheme`,
-- routed like the others at /admin/ai-models. It starts on the same provider
-- and model as the paper's marking route, (assessment-paper, NULL). No
-- existing route is changed.

BEGIN;

INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'surface:assessment-mark-scheme', NULL,
       coalesce(r.provider, 'anthropic'), coalesce(r.model, 'claude-sonnet-5'), r.effort, 'migration-136'
  FROM (SELECT 1) one
  LEFT JOIN ai_model_routes r ON r.activity_type = 'assessment-paper' AND r.sc_type IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM ai_model_routes
                    WHERE activity_type = 'surface:assessment-mark-scheme' AND sc_type IS NULL);

COMMIT;
