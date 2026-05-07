-- src/migrations/20260507_add_planner_assignments.sql

CREATE TABLE IF NOT EXISTS planner_assignments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         text        NOT NULL REFERENCES groups(group_id),
  lesson_id        text        NOT NULL REFERENCES lessons(lesson_id),
  week_start_date  date        NOT NULL,
  day              text        NOT NULL
                               CHECK (day IN ('sunday','monday','tuesday','wednesday','thursday')),
  period           integer     NOT NULL CHECK (period BETWEEN 1 AND 7),
  feedback_visible boolean     NOT NULL DEFAULT false,
  issue_flag       boolean     NOT NULL DEFAULT false,
  issue_note       text        NOT NULL DEFAULT '',
  notes            text        NOT NULL DEFAULT '',
  created_by       text        REFERENCES profiles(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, week_start_date, day, period)
);

CREATE TABLE IF NOT EXISTS timetable_slot_groups (
  teacher_id  text     NOT NULL REFERENCES profiles(user_id),
  day         text     NOT NULL CHECK (day IN ('sunday','monday','tuesday','wednesday','thursday')),
  period      integer  NOT NULL CHECK (period BETWEEN 1 AND 7),
  group_id    text     REFERENCES groups(group_id),
  PRIMARY KEY (teacher_id, day, period)
);

CREATE INDEX IF NOT EXISTS idx_planner_assignments_week_start_date
  ON planner_assignments(week_start_date);

CREATE INDEX IF NOT EXISTS idx_planner_assignments_group_id
  ON planner_assignments(group_id);
