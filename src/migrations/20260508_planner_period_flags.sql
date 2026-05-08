-- Period-level warning flags (independent of lesson assignments)
CREATE TABLE IF NOT EXISTS planner_period_flags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date  DATE    NOT NULL,
  day              TEXT    NOT NULL,
  period           INTEGER NOT NULL,
  issue_flag       BOOLEAN NOT NULL DEFAULT false,
  issue_note       TEXT    NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_start_date, day, period)
);
