-- 120-oauth-project-keys.sql
--
-- Lets other school projects manage their own first-party OAuth clients with a
-- per-project API key, and call each other with short-lived service tokens
-- (client_credentials). See docs/FIRST-PARTY-CLIENTS.md.
--
-- There is deliberately no shared secret: each project has its own key and
-- each service client its own secret, so one leak is revoked on its own.
-- Keys and secrets are 256-bit random values, so like oauth_tokens only their
-- SHA-256 is stored.
--
-- MCP and dynamically registered clients keep every default below and behave
-- exactly as before.

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  -- 8 characters of the key after "dino_pk_", shown in lists and logs.
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  -- During a rotation the old key keeps working until previous_expires_at.
  previous_key_prefix text,
  previous_key_hash text UNIQUE,
  previous_expires_at timestamptz,
  -- The ceiling: nothing a key's clients are given may exceed these.
  allowed_roles text[] NOT NULL,
  allowed_scopes text[] NOT NULL DEFAULT '{}',
  allowed_redirect_hosts text[] NOT NULL,
  allowed_audiences text[] NOT NULL DEFAULT '{}',
  max_clients integer NOT NULL DEFAULT 5 CHECK (max_clients >= 0),
  client_id_prefix text NOT NULL CHECK (length(client_id_prefix) >= 2),
  -- New clients start disabled until an admin approves them.
  requires_approval boolean NOT NULL DEFAULT true,
  created_by text REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

ALTER TABLE oauth_clients
  -- NULL = created by an admin or a script.
  ADD COLUMN IF NOT EXISTS owner_key_id uuid REFERENCES oauth_api_keys(id),
  -- A disabled client cannot sign anyone in, refresh, or get a service token.
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  -- Created by a key that requires approval: only an admin can enable it.
  ADD COLUMN IF NOT EXISTS pending_approval boolean NOT NULL DEFAULT false,
  -- Disabled by an admin: the owning project cannot enable it again.
  ADD COLUMN IF NOT EXISTS disabled_by_admin boolean NOT NULL DEFAULT false,
  -- 'public': signs people in (PKCE, no secret). 'service': confidential,
  -- client_credentials only, acts as itself and never as a user.
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'public'
    CHECK (client_type IN ('public', 'service')),
  ADD COLUMN IF NOT EXISTS client_secret_hash text,
  ADD COLUMN IF NOT EXISTS previous_client_secret_hash text,
  ADD COLUMN IF NOT EXISTS previous_secret_expires_at timestamptz,
  -- Service clients: the audiences they may ask a token for, and its scopes.
  ADD COLUMN IF NOT EXISTS allowed_audiences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_service_scopes text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS oauth_clients_owner_key_id_idx ON oauth_clients (owner_key_id);

-- A service token's audience is chosen per request, so a service client has
-- no fixed audience.
ALTER TABLE oauth_clients DROP CONSTRAINT IF EXISTS oauth_clients_jwt_has_audience;
ALTER TABLE oauth_clients
  ADD CONSTRAINT oauth_clients_jwt_has_audience
  CHECK (token_format <> 'jwt' OR audience IS NOT NULL OR client_type = 'service');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_clients_service_shape') THEN
    ALTER TABLE oauth_clients
      ADD CONSTRAINT oauth_clients_service_shape
      CHECK (client_type <> 'service'
             OR (first_party AND token_format = 'jwt' AND client_secret_hash IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_clients_owned_first_party') THEN
    ALTER TABLE oauth_clients
      ADD CONSTRAINT oauth_clients_owned_first_party
      CHECK (owner_key_id IS NULL OR first_party);
  END IF;
END $$;

-- Fixed one-minute windows, one row per key per minute.
CREATE TABLE IF NOT EXISTS oauth_api_key_usage (
  key_id uuid NOT NULL REFERENCES oauth_api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL,
  PRIMARY KEY (key_id, window_start)
);

-- Every change to a first-party client or a key, by a project key, an admin
-- or a script. Never a key, a secret or a hash of one.
CREATE TABLE IF NOT EXISTS oauth_client_audit_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL CHECK (actor IN ('api_key', 'admin', 'script')),
  api_key_id uuid REFERENCES oauth_api_keys(id) ON DELETE SET NULL,
  key_name text,
  key_prefix text,
  user_id text REFERENCES profiles(user_id) ON DELETE SET NULL,
  client_id text,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'refused', 'error')),
  status integer,
  error text
);

CREATE INDEX IF NOT EXISTS oauth_client_audit_log_created_at_idx ON oauth_client_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS oauth_client_audit_log_client_idx ON oauth_client_audit_log (client_id, created_at DESC);

COMMIT;
