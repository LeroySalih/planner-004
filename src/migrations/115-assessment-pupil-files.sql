-- 115-assessment-pupil-files.sql
--
-- A file attached to an assessment paper (usually a scan of one pupil's
-- script) can be linked to that pupil. Once the paper's feedback is released,
-- the pupil can open the files linked to them, and no others; unlinked files
-- stay teacher-only.
--
-- Keyed by file name, as the store is: re-uploading a file under the same name
-- keeps its link.

BEGIN;

CREATE TABLE IF NOT EXISTS assessment_pupil_files (
  assessment_id uuid NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  pupil_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, file_name)
);

CREATE INDEX IF NOT EXISTS assessment_pupil_files_pupil_idx ON assessment_pupil_files (assessment_id, pupil_id);

-- An MCP upload link may name the pupil the file belongs to.
ALTER TABLE mcp_upload_links
  ADD COLUMN IF NOT EXISTS pupil_id text REFERENCES profiles(user_id) ON DELETE CASCADE;

COMMIT;
