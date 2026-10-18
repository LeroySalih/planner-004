-- 122-year-group-top-level.sql
--
-- Levels follow the Grade Boundary Calculator: every year group runs 1L, 1M,
-- 1H, 2L ... up to its own top level, in equal steps over 0-100% rounded to
-- whole percents (src/lib/levels). So a year group needs only its top level, e.g. 5M;
-- migration 121's lowest/highest whole levels are replaced.

BEGIN;

ALTER TABLE year_group_levels
  ADD COLUMN IF NOT EXISTS top_level text CHECK (top_level ~ '^[1-9][LMH]$');

UPDATE year_group_levels
SET top_level = CASE year_group
    WHEN 7 THEN '5M'
    WHEN 8 THEN '6M'
    WHEN 9 THEN '7M'
    WHEN 10 THEN '8H'
    WHEN 11 THEN '9H'
    ELSE max_level || 'H'
  END
WHERE top_level IS NULL;

ALTER TABLE year_group_levels
  ALTER COLUMN top_level SET NOT NULL,
  DROP COLUMN IF EXISTS min_level,
  DROP COLUMN IF EXISTS max_level;

COMMIT;
