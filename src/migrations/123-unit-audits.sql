-- 123-unit-audits.sql
--
-- A unit can be audited: an auditor (in practice Claude, over MCP) checks the
-- unit and its lessons and records a pass, or a fail with the actions that
-- would fix it. Any later change to the unit or its lessons makes it "not
-- audited" again.
--
-- The status is derived, never stored: a unit is audited when its last audit
-- is newer than its last change (changed_at, kept by the triggers below).
-- Triggers rather than app code, because units and lessons are written from
-- the app, the MCP server and both AI chats, and a missed path would leave a
-- stale "audited". A pass recorded with a start time older than a change made
-- during the audit therefore reads "not audited" too.
--
-- What counts as a change:
--   units                   title, subject, description, year, curriculum, active
--   lessons                 added, removed, retitled, reordered, (de)activated,
--                           moved between units. Not is_public or
--                           hidden_from_pupils: those are visibility, not content.
--   activities, lesson_links, lessons_learning_objective,
--   lesson_success_criteria, activity_success_criteria, success_criteria_units
--                           any insert, delete or real update
--   stored_files            unit files, lesson files and activity files; not
--                           pupils' uploads (lessons/<l>/activities/<a>/<pupil>)
-- Intervention lessons are one pupil's work and never count. Editing the text
-- of a shared LO or SC on the curriculum page does not count either: it would
-- reset every unit using it.

BEGIN;

CREATE TABLE IF NOT EXISTS unit_audits (
  unit_id text PRIMARY KEY REFERENCES units(unit_id) ON DELETE CASCADE,
  result text CHECK (result IN ('passed', 'failed')),
  audited_at timestamptz,
  audited_by text REFERENCES profiles(user_id) ON DELETE SET NULL,
  audited_by_client text,
  -- [{ "action": text, "lesson_id": text | null }], replaced by each audit.
  actions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actions) = 'array'),
  changed_at timestamptz,
  CHECK ((result IS NULL) = (audited_at IS NULL)),
  CHECK (result IS DISTINCT FROM 'passed' OR actions = '[]'::jsonb)
);

COMMENT ON TABLE unit_audits IS
  'Last audit of a unit and its last content change. Audited iff audited_at > changed_at; see migration 123.';

-- clock_timestamp, not now(): now() is the transaction start, so a long edit
-- could otherwise stamp a change earlier than an audit recorded meanwhile.
CREATE OR REPLACE FUNCTION unit_audit_touch(p_unit_id text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_unit_id IS NULL THEN RETURN; END IF;
  -- Through units, so a unit being deleted (cascading to its lessons) is a no-op.
  INSERT INTO unit_audits (unit_id, changed_at)
  SELECT u.unit_id, clock_timestamp() FROM units u WHERE u.unit_id = p_unit_id
  ON CONFLICT (unit_id) DO UPDATE SET changed_at = EXCLUDED.changed_at;
END $$;

CREATE OR REPLACE FUNCTION unit_audit_touch_lesson(p_lesson_id text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM unit_audit_touch(l.unit_id)
     FROM lessons l
    WHERE l.lesson_id = p_lesson_id AND l.kind = 'standard';
END $$;

-- One trigger function for every table; TG_ARGV[0] says how a row finds its unit.
CREATE OR REPLACE FUNCTION unit_audits_on_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb;
  scope text[];
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NULL;
  END IF;
  FOREACH rec IN ARRAY CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[to_jsonb(NEW)]
      WHEN 'DELETE' THEN ARRAY[to_jsonb(OLD)]
      ELSE ARRAY[to_jsonb(OLD), to_jsonb(NEW)]
    END
  LOOP
    CASE TG_ARGV[0]
      WHEN 'unit' THEN
        PERFORM unit_audit_touch(rec->>'unit_id');
      WHEN 'lesson_row' THEN
        -- The lessons table itself: read the row, it may be the one deleted.
        IF rec->>'kind' = 'standard' THEN
          PERFORM unit_audit_touch(rec->>'unit_id');
        END IF;
      WHEN 'lesson' THEN
        PERFORM unit_audit_touch_lesson(rec->>'lesson_id');
      WHEN 'activity' THEN
        PERFORM unit_audit_touch_lesson(a.lesson_id)
           FROM activities a WHERE a.activity_id = rec->>'activity_id';
      WHEN 'file' THEN
        scope := string_to_array(rec->>'scope_path', '/');
        IF rec->>'bucket' = 'units' THEN
          PERFORM unit_audit_touch(scope[1]);
        ELSIF rec->>'bucket' = 'lessons' AND cardinality(scope) IN (1, 3) THEN
          -- <lesson> or <lesson>/activities/<activity>; four parts is a pupil's upload.
          PERFORM unit_audit_touch_lesson(scope[1]);
        END IF;
    END CASE;
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS unit_audits_units ON units;
CREATE TRIGGER unit_audits_units
  AFTER UPDATE ON units FOR EACH ROW
  WHEN ((OLD.title, OLD.subject, OLD.description, OLD.year, OLD.curriculum_id, OLD.active)
        IS DISTINCT FROM (NEW.title, NEW.subject, NEW.description, NEW.year, NEW.curriculum_id, NEW.active))
  EXECUTE FUNCTION unit_audits_on_change('unit');

DROP TRIGGER IF EXISTS unit_audits_lessons_insert_delete ON lessons;
CREATE TRIGGER unit_audits_lessons_insert_delete
  AFTER INSERT OR DELETE ON lessons FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('lesson_row');

DROP TRIGGER IF EXISTS unit_audits_lessons_update ON lessons;
CREATE TRIGGER unit_audits_lessons_update
  AFTER UPDATE ON lessons FOR EACH ROW
  WHEN ((OLD.unit_id, OLD.title, OLD.active, OLD.order_by)
        IS DISTINCT FROM (NEW.unit_id, NEW.title, NEW.active, NEW.order_by))
  EXECUTE FUNCTION unit_audits_on_change('lesson_row');

DROP TRIGGER IF EXISTS unit_audits_activities ON activities;
CREATE TRIGGER unit_audits_activities
  AFTER INSERT OR UPDATE OR DELETE ON activities FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('lesson');

DROP TRIGGER IF EXISTS unit_audits_lesson_links ON lesson_links;
CREATE TRIGGER unit_audits_lesson_links
  AFTER INSERT OR UPDATE OR DELETE ON lesson_links FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('lesson');

DROP TRIGGER IF EXISTS unit_audits_lessons_learning_objective ON lessons_learning_objective;
CREATE TRIGGER unit_audits_lessons_learning_objective
  AFTER INSERT OR UPDATE OR DELETE ON lessons_learning_objective FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('lesson');

DROP TRIGGER IF EXISTS unit_audits_lesson_success_criteria ON lesson_success_criteria;
CREATE TRIGGER unit_audits_lesson_success_criteria
  AFTER INSERT OR UPDATE OR DELETE ON lesson_success_criteria FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('lesson');

DROP TRIGGER IF EXISTS unit_audits_activity_success_criteria ON activity_success_criteria;
CREATE TRIGGER unit_audits_activity_success_criteria
  AFTER INSERT OR UPDATE OR DELETE ON activity_success_criteria FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('activity');

DROP TRIGGER IF EXISTS unit_audits_success_criteria_units ON success_criteria_units;
CREATE TRIGGER unit_audits_success_criteria_units
  AFTER INSERT OR UPDATE OR DELETE ON success_criteria_units FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('unit');

DROP TRIGGER IF EXISTS unit_audits_stored_files ON stored_files;
CREATE TRIGGER unit_audits_stored_files
  AFTER INSERT OR UPDATE OR DELETE ON stored_files FOR EACH ROW
  EXECUTE FUNCTION unit_audits_on_change('file');

COMMIT;
