-- 106-mcp-audit-log.sql
--
-- One row per MCP tool call or MCP file upload, so every change Claude makes
-- to DINO can be traced to the teacher whose sign-in it used.
--
-- The teacher's name and email are copied onto the row at the time of the
-- call: user_id is nulled if the profile is ever deleted, and the log must
-- still say who acted. Service-key calls (scripts) have no user.

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  auth_method text NOT NULL CHECK (auth_method IN ('oauth', 'service_key')),
  user_id text REFERENCES profiles(user_id) ON DELETE SET NULL,
  user_name text,
  user_email text,
  oauth_client_id text,
  oauth_client_name text,
  tool text NOT NULL,
  is_write boolean NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error')),
  error text,
  duration_ms integer
);

CREATE INDEX IF NOT EXISTS mcp_audit_log_created_at_idx ON mcp_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_log_user_idx ON mcp_audit_log (user_id, created_at DESC);

COMMIT;
