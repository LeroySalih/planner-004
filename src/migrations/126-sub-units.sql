-- 126-sub-units.sql
--
-- A unit's lessons can be grouped into sub units, to help teachers plan and
-- to give pupils section headings on My Units. A lesson belongs to at most
-- one sub unit of its own unit, or to none (sub_unit_id null).
--
-- Sub units are structure only. Nothing in reports or progress reads them,
-- and lessons keep one order_by across the whole unit, so lesson numbering
-- and every score are unchanged by grouping.
--
-- The composite foreign key keeps a lesson's sub unit inside the lesson's
-- unit. Moving a lesson to another unit clears its sub unit first, or the key
-- would refuse the move. Deleting a sub unit returns its lessons to the unit.
--
-- Sub units are unit content, so changing one, or a lesson's sub unit, makes
-- the unit "not audited" (migration 123).

BEGIN;

CREATE TABLE IF NOT EXISTS sub_units (
  sub_unit_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  unit_id     text NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 255),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sub_unit_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_sub_units_unit ON sub_units (unit_id);

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS sub_unit_id text;

ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_sub_unit_fkey;
ALTER TABLE lessons ADD CONSTRAINT lessons_sub_unit_fkey
  FOREIGN KEY (sub_unit_id, unit_id) REFERENCES sub_units (sub_unit_id, unit_id)
  ON DELETE SET NULL (sub_unit_id);

CREATE INDEX IF NOT EXISTS idx_lessons_sub_unit ON lessons (sub_unit_id) WHERE sub_unit_id IS NOT NULL;

COMMENT ON COLUMN lessons.sub_unit_id IS
  'The sub unit of this lesson''s unit it is grouped under, or null. Planning structure only.';

CREATE OR REPLACE FUNCTION lessons_clear_sub_unit_on_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    NEW.sub_unit_id := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lessons_clear_sub_unit_on_move ON lessons;
CREATE TRIGGER lessons_clear_sub_unit_on_move
  BEFORE UPDATE OF unit_id ON lessons FOR EACH ROW
  EXECUTE FUNCTION lessons_clear_sub_unit_on_move();

DROP TRIGGER IF EXISTS unit_audits_sub_units ON sub_units;
CREATE TRIGGER unit_audits_sub_units
  AFTER INSERT OR DELETE OR UPDATE OF unit_id, title, description, active ON sub_units FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('unit');

DROP TRIGGER IF EXISTS unit_audits_lessons_update ON lessons;
CREATE TRIGGER unit_audits_lessons_update
  AFTER UPDATE ON lessons FOR EACH ROW
  WHEN ((OLD.unit_id, OLD.title, OLD.description, OLD.active, OLD.order_by, OLD.sub_unit_id)
        IS DISTINCT FROM (NEW.unit_id, NEW.title, NEW.description, NEW.active, NEW.order_by, NEW.sub_unit_id))
  EXECUTE FUNCTION unit_audits_on_change('lesson_row');

COMMIT;
