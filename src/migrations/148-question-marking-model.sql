-- A question-marked activity (assessment paper, PowerPoint or database
-- assessment) can name the model that marks each question.
--
--   * marking_model: a MODEL_CATALOGUE model id (src/lib/ai/model-routing.ts),
--     or null for the activity's route in ai_model_routes, as before.
--
-- The rule that a question whose marker is sent pictures (every assessment
-- paper question; slide pictures, a PDF or screenshots on a practical one)
-- must name a high-resolution vision model is checked by
-- setAssessmentQuestions, and again when the question is marked: a stored
-- model that is no longer allowed falls back to the activity's route.

BEGIN;

ALTER TABLE activity_questions ADD COLUMN IF NOT EXISTS marking_model text;

COMMIT;
