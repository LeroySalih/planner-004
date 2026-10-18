-- 121-year-group-levels.sql
--
-- The range of levels a year group can be awarded, set by an admin at
-- /admin/levels instead of in code. A score is placed on the sub-levels from
-- min_level L to max_level H, evenly spaced over 0-100% (src/lib/levels).
--
-- A year group with no row gets no level.

BEGIN;

CREATE TABLE IF NOT EXISTS year_group_levels (
  year_group integer PRIMARY KEY CHECK (year_group BETWEEN 1 AND 13),
  min_level integer NOT NULL CHECK (min_level BETWEEN 1 AND 9),
  max_level integer NOT NULL CHECK (max_level BETWEEN 1 AND 9),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES profiles(user_id) ON DELETE SET NULL,
  CHECK (min_level <= max_level)
);

INSERT INTO year_group_levels (year_group, min_level, max_level) VALUES
  (7, 1, 3),
  (8, 2, 4),
  (9, 3, 5),
  (10, 1, 7),
  (11, 1, 9)
ON CONFLICT (year_group) DO NOTHING;

COMMIT;
