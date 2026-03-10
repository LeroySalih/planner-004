-- weekly_plan_notes: teacher rich-text note per group per week
CREATE TABLE IF NOT EXISTS weekly_plan_notes (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  week_start_date  DATE NOT NULL,
  content          TEXT NOT NULL,
  created_by       TEXT NOT NULL REFERENCES profiles(user_id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, week_start_date)
);

-- weekly_plan_questions: pupil question on a lesson or activity
CREATE TABLE IF NOT EXISTS weekly_plan_questions (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    TEXT NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  activity_id  TEXT REFERENCES activities(activity_id) ON DELETE SET NULL,
  user_id      TEXT NOT NULL REFERENCES profiles(user_id),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- weekly_plan_replies: flat teacher reply to a question
CREATE TABLE IF NOT EXISTS weekly_plan_replies (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  TEXT NOT NULL REFERENCES weekly_plan_questions(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES profiles(user_id),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_plan_notes_group_id ON weekly_plan_notes(group_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_questions_lesson_id ON weekly_plan_questions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_questions_user_id ON weekly_plan_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_replies_question_id ON weekly_plan_replies(question_id);
