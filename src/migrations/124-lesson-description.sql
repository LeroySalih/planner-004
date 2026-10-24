-- 124-lesson-description.sql
--
-- A lesson's description: one short sentence telling pupils what they will
-- achieve, written from its learning objectives and success criteria. Shown
-- under the title on the pupil lesson page; read and written over MCP
-- (update_lesson, get_lesson_objectives, get_lessons_for_unit).
--
-- Null means none. 300 characters keeps it to a sentence or two.
--
-- It is lesson content, so changing it makes the unit "not audited"
-- (migration 123): the lessons update trigger is recreated with it added.

BEGIN;

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_description_length;
ALTER TABLE lessons ADD CONSTRAINT lessons_description_length
  CHECK (description IS NULL OR char_length(description) <= 300);

COMMENT ON COLUMN lessons.description IS
  'One short sentence for pupils on what the lesson achieves. Null when unset. Max 300 chars.';

DROP TRIGGER IF EXISTS unit_audits_lessons_update ON lessons;
CREATE TRIGGER unit_audits_lessons_update
  AFTER UPDATE ON lessons FOR EACH ROW
  WHEN ((OLD.unit_id, OLD.title, OLD.description, OLD.active, OLD.order_by)
        IS DISTINCT FROM (NEW.unit_id, NEW.title, NEW.description, NEW.active, NEW.order_by))
  EXECUTE FUNCTION unit_audits_on_change('lesson_row');

COMMIT;
