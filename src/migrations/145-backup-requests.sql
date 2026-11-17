-- 145-backup-requests.sql
--
-- "Back up now" on /admin/backups. The web app has no Docker socket and no
-- SSH key, so it cannot take a backup itself: it only records a request here.
-- scripts/backup-on-request.sh, run every minute by the prod host's cron,
-- claims the oldest pending request, runs backup-db.sh manual, pushes the
-- dumps to the coding server with push-to-coding.sh dumps <timestamp>, and
-- writes the outcome back.
--
--   pending -> running -> done | error
--
-- At most one request is pending or running at a time (partial unique index),
-- so pressing the button twice cannot queue two backups.
--
-- Operations, not lesson content: no unit_audits trigger (migration 123).

BEGIN;

CREATE TABLE IF NOT EXISTS backup_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'error')),
  started_at timestamptz,
  finished_at timestamptz,
  -- [{name, bytes}] for each dump written
  files jsonb,
  error text
);

CREATE UNIQUE INDEX IF NOT EXISTS backup_requests_one_open
  ON backup_requests ((true))
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS backup_requests_requested_at
  ON backup_requests (requested_at DESC);

COMMIT;
