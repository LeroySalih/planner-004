-- 119-kerf-sso.sql
--
-- First-party sign-in for the Kerf Sabre apps on DINO's OAuth server
-- (docs/KERF-SSO.md). MCP clients keep every default below, so their
-- behaviour is unchanged: opaque tokens, teacher only, no scopes.
--
-- Kerf's clients are not inserted here: their redirect URIs differ per
-- environment, so scripts/register-oauth-client.ts upserts them.

BEGIN;

ALTER TABLE oauth_clients
  -- Pre-registered by DINO, not by RFC 7591: exact redirect URIs, no consent
  -- page, never pruned, never touched by /oauth/register.
  ADD COLUMN IF NOT EXISTS first_party boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_format text NOT NULL DEFAULT 'opaque'
    CHECK (token_format IN ('opaque', 'jwt')),
  -- Roles allowed to sign in through this client. NULL = teacher only (MCP's rule).
  ADD COLUMN IF NOT EXISTS allowed_roles text[],
  -- The JWT "aud" claim. Required when token_format = 'jwt'.
  ADD COLUMN IF NOT EXISTS audience text,
  -- Scopes this client may ask for: any of 'profile', 'groups'.
  ADD COLUMN IF NOT EXISTS allowed_scopes text[] NOT NULL DEFAULT '{}',
  -- NULL = the server defaults (1 hour / 30 days).
  ADD COLUMN IF NOT EXISTS access_ttl_seconds integer CHECK (access_ttl_seconds > 0),
  ADD COLUMN IF NOT EXISTS refresh_ttl_seconds integer CHECK (refresh_ttl_seconds > 0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_clients_jwt_has_audience') THEN
    ALTER TABLE oauth_clients
      ADD CONSTRAINT oauth_clients_jwt_has_audience
      CHECK (token_format <> 'jwt' OR audience IS NOT NULL);
  END IF;
END $$;

-- The granted scope, space separated ('' = none).
ALTER TABLE oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT '';

ALTER TABLE oauth_tokens
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT '';

COMMIT;
