-- Migration 070: do-flashcards activity type
-- Adds do_activity_id to flashcard_sessions, injects do-flashcards activities
-- for existing display-flashcards, and backfills submission scores.

-- Step 1: Add do_activity_id column to flashcard_sessions
ALTER TABLE flashcard_sessions
  ADD COLUMN IF NOT EXISTS do_activity_id text;

-- Steps 2-4 are one atomic statement: insert activities, backfill submissions,
-- and stamp do_activity_id — all scoped to the activities just inserted.
BEGIN;

WITH inserted AS (
  INSERT INTO activities (activity_id, lesson_id, title, type, body_data, order_by, active, is_summative)
  SELECT
    gen_random_uuid()::text,
    a.lesson_id,
    'Do: ' || coalesce(a.title, 'Flashcards'),
    'do-flashcards',
    jsonb_build_object('flashcardActivityId', a.activity_id),
    coalesce(a.order_by, 0) + 1,
    true,
    false
  FROM activities a
  WHERE a.type = 'display-flashcards'
    AND coalesce(a.active, true) = true  -- NULL active treated as active (project convention)
  RETURNING activity_id, (body_data->>'flashcardActivityId') AS source_activity_id
),
backfilled AS (
  INSERT INTO submissions (submission_id, activity_id, user_id, submitted_at, body, is_flagged)
  SELECT
    gen_random_uuid()::text,
    i.activity_id,
    fs.pupil_id,
    fs.completed_at,
    json_build_object(
      'score',        fs.correct_count::numeric / fs.total_cards,
      'correctCount', fs.correct_count,
      'totalCards',   fs.total_cards,
      'sessionId',    fs.session_id
    ),
    false
  FROM flashcard_sessions fs
  JOIN inserted i ON i.source_activity_id = fs.activity_id
  WHERE fs.status = 'completed'
    AND fs.total_cards > 0
  RETURNING submission_id
),
updated AS (
  UPDATE flashcard_sessions fs
  SET do_activity_id = i.activity_id
  FROM inserted i
  WHERE fs.activity_id = i.source_activity_id
  RETURNING fs.session_id
)
SELECT
  (SELECT count(*) FROM inserted)   AS activities_created,
  (SELECT count(*) FROM backfilled) AS submissions_created,
  (SELECT count(*) FROM updated)    AS sessions_updated;

COMMIT;
