-- 139-profile-active.sql
--
-- An account can be made inactive, e.g. a pupil who has left the school. An
-- inactive account cannot sign in, its sessions end on the next request and
-- OAuth refuses it; its submissions, marks and feedback are kept, so reports
-- and history are unchanged. Set by scripts/purge-leavers.sh.

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

COMMIT;
