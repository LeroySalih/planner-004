-- 109-intervention-soft-delete.sql
--
-- Teachers can delete interventions from /interventions. The delete is soft:
-- the row, the lesson and the pupil's work are kept, but an inactive
-- intervention is left out of every list, report and MCP tool, and its pupil
-- can no longer open it.
--
-- This is separate from cancelled_at. A cancelled intervention is still on
-- the record (the Cancelled tab, the pupil report); a deleted one is gone
-- from view, e.g. one created by mistake.

BEGIN;

ALTER TABLE intervention_assignments
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text REFERENCES profiles(user_id) ON DELETE SET NULL;

COMMIT;
