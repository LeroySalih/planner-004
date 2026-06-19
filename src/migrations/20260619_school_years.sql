CREATE TABLE IF NOT EXISTS school_years (
  year       integer     PRIMARY KEY,  -- start year, e.g. 2025 = 2025/26
  label      text        NOT NULL,     -- display label, e.g. "2025/26"
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed current and adjacent years so the app works immediately
INSERT INTO school_years (year, label, active) VALUES
  (2024, '2024/25', true),
  (2025, '2025/26', true),
  (2026, '2026/27', true)
ON CONFLICT (year) DO NOTHING;
