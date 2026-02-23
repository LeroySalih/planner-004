CREATE TABLE IF NOT EXISTS handwriting_scans (
  scan_id       TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  image_path    TEXT NOT NULL,
  original_text TEXT NOT NULL,
  edited_text   TEXT,
  similarity    NUMERIC(5,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handwriting_scans_user_id ON handwriting_scans(user_id);
CREATE INDEX IF NOT EXISTS idx_handwriting_scans_created_at ON handwriting_scans(created_at DESC);
