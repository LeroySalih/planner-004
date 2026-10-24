-- 125-lesson-understanding.sql
--
-- "How well do I understand this lesson?" A pupil answers thumbs up or down
-- at the end of the lesson page. Each answer is a dated row rather than one
-- overwritten value, so how a pupil's confidence in a lesson changes over time
-- can be followed. Their latest row is their current answer.
--
-- Pressing the same answer again the same day adds nothing; a changed answer,
-- or the same answer on a later day, adds a row (src/lib/lesson-understanding).

BEGIN;

CREATE TABLE IF NOT EXISTS lesson_understanding (
  understanding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pupil_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  rating text NOT NULL CHECK (rating IN ('up', 'down')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_understanding_pupil_lesson
  ON lesson_understanding (pupil_id, lesson_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS lesson_understanding_lesson
  ON lesson_understanding (lesson_id, recorded_at DESC);

COMMENT ON TABLE lesson_understanding IS
  'A pupil''s thumbs up/down on how well they understand a lesson, one row per answer over time; the latest is current. Migration 125.';

COMMIT;
