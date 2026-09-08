-- 094-lesson-hidden-from-pupils.sql
--
-- Lets a teacher take a lesson out of pupils' hands without deleting it or
-- unpicking it from the planner: hidden lessons drop out of every pupil list
-- and their URLs stop resolving for pupils.
--
-- A new column rather than reusing lessons.active. active governs whether a
-- lesson shows in the teacher's unit list and is not consulted anywhere on the
-- pupil path today, so overloading it would have hidden every already-inactive
-- lesson from pupils the moment this shipped — a silent change to live data.
--
-- Not null with a default, so every existing lesson stays visible.

BEGIN;

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS hidden_from_pupils boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lessons.hidden_from_pupils IS
  'When true the lesson is withheld from pupils: filtered out of the pupil lesson lists and refused on /lessons/[id] for anyone without a teacher role. Teachers still see it everywhere.';

CREATE INDEX IF NOT EXISTS idx_lessons_hidden_from_pupils
  ON public.lessons (lesson_id) WHERE hidden_from_pupils;

COMMIT;
