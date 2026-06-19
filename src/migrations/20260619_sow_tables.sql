-- src/migrations/20260619_sow_tables.sql

CREATE TABLE IF NOT EXISTS half_terms (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  year       integer NOT NULL,
  name       text    NOT NULL CHECK (name IN ('H1','H2','H3','H4','H5','H6')),
  start_date date    NOT NULL,
  end_date   date    NOT NULL,
  UNIQUE (year, name)
);

CREATE TABLE IF NOT EXISTS sow_lesson_plan (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        text        NOT NULL REFERENCES groups(group_id),
  lesson_id       text        NOT NULL REFERENCES lessons(lesson_id),
  unit_id         text        NOT NULL,
  week_start_date date        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, lesson_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_sow_lesson_plan_group_week
  ON sow_lesson_plan (group_id, week_start_date);

CREATE TABLE IF NOT EXISTS sow_half_term_units (
  group_id     text    NOT NULL REFERENCES groups(group_id),
  half_term_id uuid    NOT NULL REFERENCES half_terms(id) ON DELETE CASCADE,
  unit_id      text    NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, half_term_id, unit_id)
);
