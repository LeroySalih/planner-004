DROP TABLE IF EXISTS success_criteria CASCADE;
DROP TABLE IF EXISTS lessons_learning_objective;
DROP TABLE IF EXISTS learning_objectives;

CREATE TABLE learning_objectives (
  learning_objective_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_objective_id TEXT NOT NULL REFERENCES assessment_objectives(assessment_objective_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX learning_objectives_assessment_objective_id_idx
  ON learning_objectives (assessment_objective_id, order_index);

CREATE TABLE lessons_learning_objective (
  learning_objective_id TEXT NOT NULL REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (learning_objective_id, lesson_id)
);
