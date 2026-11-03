-- 138-lesson-view-mode.sql
--
-- Each user chooses how a pupil lesson is laid out: 'page' (the article
-- layout, the default) or 'slides' (every activity fills the screen and fades
-- in as the pupil scrolls, with a sidebar of links between activities). Stored
-- on the profile so it follows the user across devices and the server renders
-- the chosen layout directly.

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS lesson_view_mode text NOT NULL DEFAULT 'page';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_lesson_view_mode_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_lesson_view_mode_check CHECK (lesson_view_mode IN ('page', 'slides'));

COMMIT;
