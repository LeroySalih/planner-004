-- 107-mcp-upload-links.sql
--
-- One-time upload links, so Claude can send a file it made in its code
-- sandbox straight to DINO. Claude's chat apps cannot pass a large file
-- through a tool call, and the sandbox has no copy of the connector's
-- credentials, so a link carries its own narrow permission instead: one
-- file, to one activity or one lesson's teacher files, within 15 minutes.
--
-- Only a SHA-256 hash of the token is stored, as for OAuth tokens. The
-- teacher who asked for the link is recorded so the upload is attributed to
-- them in mcp_audit_log.

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_upload_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  target text NOT NULL CHECK (target IN ('activity', 'lesson')),
  lesson_id text NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  activity_id text REFERENCES activities(activity_id) ON DELETE CASCADE,
  file_name text,
  auth_method text NOT NULL CHECK (auth_method IN ('oauth', 'service_key')),
  user_id text REFERENCES profiles(user_id) ON DELETE CASCADE,
  oauth_client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK ((target = 'activity') = (activity_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS mcp_upload_links_expires_at_idx ON mcp_upload_links (expires_at);

COMMIT;
