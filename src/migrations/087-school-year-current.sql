-- 087-school-year-current.sql
--
-- Mark one school year as "current". That year becomes the app-wide default
-- instead of deriving it from the server clock.
--
-- Previously currentAcademicYear() computed the default from today's date with
-- a September rollover. That is right most of the time and wrong exactly when
-- it matters — a school setting up next year in July, or running a transition
-- period, had no way to say so.
--
-- Requires 086-upload-code-activity-score.sql.

BEGIN;

ALTER TABLE school_years
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

-- At most one current year, enforced by the database rather than by whoever
-- remembers to clear the old one.
CREATE UNIQUE INDEX IF NOT EXISTS school_years_one_current
  ON school_years ((is_current)) WHERE is_current;

COMMENT ON COLUMN school_years.is_current IS
  'The app-wide default academic year. At most one row may be true (school_years_one_current). When none is set the app falls back to deriving the year from the current date.';

-- Seed so behaviour is unchanged on the day this ships: pick the year the old
-- date calculation would have chosen (September rollover), falling back to the
-- highest active year if that one is not configured.
UPDATE school_years
SET is_current = true
WHERE year = (
  SELECT year FROM school_years
  WHERE active
  ORDER BY
    -- exact match on the date-derived academic year first
    (year = CASE
              WHEN EXTRACT(MONTH FROM now()) >= 9
              THEN EXTRACT(YEAR FROM now())::int
              ELSE EXTRACT(YEAR FROM now())::int - 1
            END) DESC,
    year DESC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM school_years WHERE is_current);

COMMIT;
