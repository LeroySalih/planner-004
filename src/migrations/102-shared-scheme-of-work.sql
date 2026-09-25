-- 102-shared-scheme-of-work.sql
--
-- A scheme of work stops being something each class keeps its own copy of.
-- Units are planned once per subject, year group and half term, and every
-- class in that subject and year reads the same plan.
--
-- Three parts:
--   1. groups.year_group, so a class knows its year without parsing its id.
--   2. sow_shared_units, the plan itself.
--   3. The plan seeded from what classes have already planned, after which
--      their own placements are cleared — sow_unit_placements survives for the
--      extras a teacher adds on top of the shared plan.

BEGIN;

-- 1. A class's year group.
--
-- Ids are shaped "26-8D-DT" and "26-10-DT", so the year is the digits after
-- the academic-year prefix. 51 of 52 active classes parse; HOME-SCHOOL does
-- not and is left null, which simply means it has no shared plan of its own.
-- The column is the source of truth from here: the id is never parsed again,
-- and a class named differently in future just needs its year set.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS year_group integer;

UPDATE groups
SET year_group = substring(group_id from '^[0-9]{2}-([0-9]{1,2})')::int
WHERE year_group IS NULL
  AND substring(group_id from '^[0-9]{2}-([0-9]{1,2})') IS NOT NULL;

COMMENT ON COLUMN groups.year_group IS
  'Year group taught, e.g. 8. Chooses which shared scheme of work the class follows. Null means the class has no shared plan.';

-- 2. The shared plan: which units a subject teaches in a half term, and in
-- what order. Keyed on the academic year as well, so next year is planned
-- without disturbing this one.
CREATE TABLE IF NOT EXISTS sow_shared_units (
  shared_unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year integer NOT NULL,
  subject text NOT NULL REFERENCES subjects(subject) ON DELETE CASCADE,
  year_group integer NOT NULL,
  half_term_name text NOT NULL,
  unit_id text NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT sow_shared_units_half_term_check
    CHECK (half_term_name = ANY (ARRAY['H1','H2','H3','H4','H5','H6'])),
  CONSTRAINT sow_shared_units_unique
    UNIQUE (academic_year, subject, year_group, half_term_name, unit_id)
);

CREATE INDEX IF NOT EXISTS sow_shared_units_lookup_idx
  ON sow_shared_units (academic_year, subject, year_group);

COMMENT ON TABLE sow_shared_units IS
  'The scheme of work for a subject and year group: which units are taught in which half term. Shared by every class in that subject and year. Per-class additions live in sow_unit_placements.';

-- 3. Seed from what classes already planned.
--
-- Classes in the same subject and year did not always agree, so a cell takes
-- the union of what any of them planned — over-including and letting an admin
-- delete beats silently dropping someone's planning. Position is the earliest
-- any class gave the unit, so the common order survives.
INSERT INTO sow_shared_units (academic_year, subject, year_group, half_term_name, unit_id, position)
SELECT p.year, g.subject, g.year_group, p.half_term_name, p.unit_id, min(p.position)
FROM sow_unit_placements p
JOIN groups g ON g.group_id = p.group_id
WHERE g.subject IS NOT NULL
  AND g.year_group IS NOT NULL
GROUP BY p.year, g.subject, g.year_group, p.half_term_name, p.unit_id
ON CONFLICT (academic_year, subject, year_group, half_term_name, unit_id) DO NOTHING;

-- Those placements are now the shared plan, so the per-class copies go. What
-- stays behind belongs to a class with no subject or no year group, which no
-- shared plan covers — it is still that class's own planning.
DELETE FROM sow_unit_placements p
USING groups g
WHERE g.group_id = p.group_id
  AND g.subject IS NOT NULL
  AND g.year_group IS NOT NULL;

COMMIT;
