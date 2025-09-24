DROP TABLE IF EXISTS lesson_assignments;

CREATE TABLE lesson_assignments (
  group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  order_by INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT lesson_assignments_pkey PRIMARY KEY (group_id, lesson_id)
);
