-- 153-password-reset-tokens.sql
--
-- "Forgot password?" (src/lib/password-reset.ts). One row per request made on
-- /forgot-password that was not over a rate limit.
--
-- token_hash is the sha256 hex of a 32-byte random token. The raw token is
-- only in the email; it is never stored or logged. A request for an address
-- with no active account still writes a row, with user_id null and a hash of
-- a token nobody gets, so the per-IP limit counts it and the work done is the
-- same either way. Such a row can never reset anything.
--
-- A token works for 30 minutes (expires_at) and once (used_at). A completed
-- reset deletes the user's other rows. Rows older than 7 days are deleted
-- by the next request.
--
-- Rate limits read this table, not memory, so every PM2 process agrees:
-- 3 requests per account and 10 per IP in an hour.
--
-- Account data, not lesson content: no unit-audit trigger.

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id text REFERENCES profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  request_ip text
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, created_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS password_reset_tokens_ip_idx
  ON password_reset_tokens (request_ip, created_at)
  WHERE request_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS password_reset_tokens_created_idx
  ON password_reset_tokens (created_at);

COMMIT;
