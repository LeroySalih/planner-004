-- 105-mcp-oauth.sql
--
-- OAuth 2.1 sign-in for the MCP server, so Claude's custom connectors connect
-- by signing a teacher in rather than by carrying the service key.
--
-- Only SHA-256 hashes of codes and tokens are stored. They are 256-bit random
-- values, so a fast hash is enough — unlike passwords there is nothing to
-- brute-force — and it lets a bearer token be looked up by its hash directly.
--
-- An oauth_tokens row is one connection: refreshing rotates its hashes in
-- place, so revoking the row ends the connection however often it has been
-- refreshed.

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id text PRIMARY KEY,
  client_name text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  -- The refresh token this row rotated away from. Presenting it again means
  -- it was stolen or replayed, and revokes the connection (OAuth 2.1 §4.3.1).
  prev_refresh_token_hash text UNIQUE,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS oauth_tokens_user_id_idx ON oauth_tokens (user_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_client_id_idx ON oauth_tokens (client_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  -- The connection this code was exchanged for, so a replayed code can revoke
  -- it (RFC 6749 §4.1.2: a code used twice means it leaked).
  token_id uuid REFERENCES oauth_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_authorization_codes_token_id_idx ON oauth_authorization_codes (token_id);

COMMIT;
