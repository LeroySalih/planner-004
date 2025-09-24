DROP TABLE IF EXISTS success_criteria_units;
DROP TABLE IF EXISTS success_criteria;

CREATE TABLE success_criteria (
  success_criteria_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_objective_id TEXT NOT NULL REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN DEFAULT TRUE
);

CREATE INDEX success_criteria_learning_objective_idx
  ON success_criteria (learning_objective_id, order_index);

CREATE TABLE success_criteria_units (
  success_criteria_id TEXT NOT NULL REFERENCES success_criteria(success_criteria_id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  PRIMARY KEY (success_criteria_id, unit_id)
);
