CREATE TABLE IF NOT EXISTS date_comments (
  date_comment_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_date    DATE NOT NULL,
  comment         TEXT NOT NULL,
  created_by      TEXT NOT NULL REFERENCES profiles(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_date_comments_comment_date ON date_comments(comment_date);
