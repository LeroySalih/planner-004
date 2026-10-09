-- 110-feedback-on-by-default.sql
--
-- Feedback is now shown to pupils straight away by default; a teacher can
-- switch it off. Previously it was off until a teacher switched it on.
--
--   planner_assignments       default flips to true, and every existing
--                             assignment is switched on
--   intervention_assignments  gains its own switch, default on (interventions
--                             previously always showed feedback, with no
--                             way to turn it off)

BEGIN;

ALTER TABLE planner_assignments ALTER COLUMN feedback_visible SET DEFAULT true;
UPDATE planner_assignments SET feedback_visible = true, updated_at = now() WHERE feedback_visible = false;

ALTER TABLE intervention_assignments
  ADD COLUMN IF NOT EXISTS feedback_visible boolean NOT NULL DEFAULT true;

COMMIT;
