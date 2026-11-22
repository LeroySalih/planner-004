-- 150-practical-text-question-routes.sql
--
-- On a practical assessment, a question whose evidence sends the marker no
-- pictures (questionSendsImages false: the presentation or database report,
-- an evidence section with want 'text', a reference file) is marked on its
-- type's own text surface: `surface:powerpoint-mark-text` or
-- `surface:database-mark-text`. Questions with slide pictures, a PDF or
-- screenshots keep the activity's route. A question's own marking_model
-- (migration 148) wins over both.
--
-- Only the PowerPoint surface is seeded, on Claude Haiku 4.5: an eval on
-- PowerPoint text-only questions matched Sonnet 5. The database surface is
-- not seeded, so database assessments stay on their activity route until an
-- admin adds a row at /admin/ai-models. Without a row (or with it inactive)
-- a text-only question uses the activity route, not the built-in default.
-- No existing route is changed.

BEGIN;

INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'surface:powerpoint-mark-text', NULL, 'anthropic', 'claude-haiku-4-5', NULL, 'migration-150'
 WHERE NOT EXISTS (SELECT 1 FROM ai_model_routes
                    WHERE activity_type = 'surface:powerpoint-mark-text' AND sc_type IS NULL);

COMMIT;
