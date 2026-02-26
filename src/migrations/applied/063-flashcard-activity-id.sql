-- Migration 063: Switch flashcard_sessions from lesson_id to activity_id
-- Supports the new display-flashcards activity type where sessions are per-activity

ALTER TABLE flashcard_sessions DROP COLUMN IF EXISTS lesson_id;
ALTER TABLE flashcard_sessions ADD COLUMN activity_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_flashcard_sessions_activity_id
  ON flashcard_sessions (activity_id);
