DROP TABLE IF EXISTS assessment_objectives CASCADE;
DROP TABLE IF EXISTS curricula CASCADE;

CREATE TABLE curricula (
  curriculum_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT REFERENCES subjects(subject) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT
);

CREATE TABLE assessment_objectives (
  assessment_objective_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id TEXT REFERENCES curricula(curriculum_id) ON DELETE CASCADE,
  unit_id TEXT UNIQUE REFERENCES units(unit_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  UNIQUE (curriculum_id, code)
);

CREATE INDEX assessment_objectives_curriculum_id_idx
  ON assessment_objectives (curriculum_id);
