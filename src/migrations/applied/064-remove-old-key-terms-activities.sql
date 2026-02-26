-- Migration 064: Remove old display-key-terms activities that were bulk-renamed
-- to display-flashcards but still have body_data.markdown (old format).
-- Only activities with body_data.lines (new format) should remain.

DELETE FROM activities
WHERE type = 'display-flashcards'
  AND (
    body_data IS NULL
    OR body_data->>'lines' IS NULL
  );
