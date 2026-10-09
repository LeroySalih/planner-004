-- 112-mcp-download-links.sql
--
-- One-time download links, the mirror of 107's upload links: Claude's code
-- sandbox has no copy of the connector's credentials, so to open a lesson's
-- deck or worksheet there it needs a link that carries its own narrow
-- permission — one teacher file of one lesson, once, within 15 minutes.
--
-- Only a SHA-256 hash of the token is stored. Pupil work is never reachable:
-- the tool only offers lesson files and activity files, not the per-pupil
-- folders beneath them.

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_download_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  lesson_id text NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  activity_id text REFERENCES activities(activity_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  auth_method text NOT NULL CHECK (auth_method IN ('oauth', 'service_key')),
  user_id text REFERENCES profiles(user_id) ON DELETE CASCADE,
  oauth_client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_download_links_expires_at_idx ON mcp_download_links (expires_at);

COMMIT;
