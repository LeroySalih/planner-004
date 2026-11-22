-- 149-assessment-text-answer-route.sql
--
-- On an assessment paper, an answer the reader recorded as text
-- (submission_question_answers.kind = 'text', status = 'answered') is marked
-- on its own model surface, `surface:assessment-mark-text`, still with the
-- answer's page images. Sketches, mixed, unreadable and continued answers
-- keep the paper's route, (assessment-paper, NULL). A question's own
-- marking_model (migration 148) wins over both.
--
-- It starts on Claude Haiku 4.5: an eval showed Haiku 4.5 with the page images
-- matched the teacher's final marks as well as Sonnet 5 on text answers.
-- Without this row (or with it inactive) text answers use the paper's route,
-- not the built-in default. No existing route is changed.

BEGIN;

INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'surface:assessment-mark-text', NULL, 'anthropic', 'claude-haiku-4-5', NULL, 'migration-149'
 WHERE NOT EXISTS (SELECT 1 FROM ai_model_routes
                    WHERE activity_type = 'surface:assessment-mark-text' AND sc_type IS NULL);

COMMIT;
