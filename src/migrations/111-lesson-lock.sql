-- 111-lesson-lock.sql
--
-- A teacher can lock an assigned lesson. A locked lesson is read-only for
-- pupils: they still open it and see their answers, marks and feedback, but
-- cannot change an answer, upload a file or download one.
--
-- The lock is per class, like feedback_visible. It is set on every planner
-- row for that class and lesson together, so a lesson planned in two slots
-- cannot be half locked; the view still takes bool_or to be safe.
--
-- lesson_assignments.locked existed before planner_assignments (migration
-- 062) but the view has returned a constant false since 20260508. It now
-- carries the real value again — and means read-only, not hidden.
--
-- Interventions get the same switch, for consistency.

BEGIN;

ALTER TABLE planner_assignments
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

ALTER TABLE intervention_assignments
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW lesson_assignments AS
  SELECT group_id,
         lesson_id,
         min(week_start_date) AS start_date,
         false AS hidden,
         bool_or(locked) AS locked,
         bool_or(feedback_visible) AS feedback_visible
    FROM planner_assignments
   GROUP BY group_id, lesson_id;

-- Whether a lesson is locked for one pupil: locked for any class of theirs
-- that has it, or their own intervention on it is locked. Every server-side
-- check calls this, so the rule lives in one place.
CREATE OR REPLACE FUNCTION pupil_lesson_locked(p_user_id text, p_lesson_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
           SELECT 1
             FROM planner_assignments pa
             JOIN group_membership gm ON gm.group_id = pa.group_id
            WHERE gm.user_id = p_user_id
              AND pa.lesson_id = p_lesson_id
              AND pa.locked
         )
      OR EXISTS (
           SELECT 1
             FROM intervention_assignments ia
            WHERE ia.pupil_id = p_user_id
              AND ia.lesson_id = p_lesson_id
              AND ia.active
              AND ia.locked
         );
$$;

COMMIT;
