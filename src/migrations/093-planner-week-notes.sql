-- 093-planner-week-notes.sql
--
-- The weekly planner has had a "Week notes" textarea since it was built, but
-- nothing ever persisted it: setWeekNotesMap was called only from the
-- textarea's own onChange, so whatever a teacher typed was lost on reload.
--
-- Keyed on (teacher, week) to match planner_assignments, which is scoped the
-- same way.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planner_week_notes (
  teacher_id      text NOT NULL,
  week_start_date date NOT NULL,
  note            text NOT NULL DEFAULT '',
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (teacher_id, week_start_date)
);

COMMENT ON TABLE public.planner_week_notes IS
  'Free-text reminders against one teacher-week, shown under the weekly planner grid. Clearing the text deletes the row rather than storing an empty string.';

COMMIT;
