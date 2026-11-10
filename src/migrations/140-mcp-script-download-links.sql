-- 140-mcp-script-download-links.sql
--
-- One-time download links (112, 137) can now fetch one pupil's original
-- uploaded script on an assessment-paper activity (132, 134), front sheet
-- included: a teacher copy, for the teacher to read or check by hand. The
-- link names the script row; uploading a replacement deletes that row, and
-- the link with it, so a link never serves a newer script than it was made
-- for.

BEGIN;

ALTER TABLE mcp_download_links
  ADD COLUMN IF NOT EXISTS script_id uuid REFERENCES assessment_scripts(script_id) ON DELETE CASCADE;

ALTER TABLE mcp_download_links DROP CONSTRAINT IF EXISTS mcp_download_links_kind_check;
ALTER TABLE mcp_download_links DROP CONSTRAINT IF EXISTS mcp_download_links_kind_shape;

ALTER TABLE mcp_download_links
  ADD CONSTRAINT mcp_download_links_kind_check
    CHECK (kind IN ('lesson_file', 'assessment_class_feedback', 'assessment_script')),
  ADD CONSTRAINT mcp_download_links_kind_shape CHECK (
    CASE kind
      WHEN 'lesson_file' THEN file_name IS NOT NULL AND group_id IS NULL AND script_id IS NULL
      WHEN 'assessment_class_feedback' THEN
        activity_id IS NOT NULL AND group_id IS NOT NULL AND file_name IS NULL AND script_id IS NULL
      ELSE activity_id IS NOT NULL AND script_id IS NOT NULL AND group_id IS NULL AND file_name IS NULL
    END
  );

COMMIT;
