-- 137-mcp-class-feedback-links.sql
--
-- One-time download links (112) can now fetch a class's consolidated
-- feedback PDF on an assessment-paper activity (132), as well as a lesson
-- file. `kind` says which. The PDF is built when the link is claimed, so it
-- has no file name until then; it names the activity and the class instead.

BEGIN;

ALTER TABLE mcp_download_links ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'lesson_file';
ALTER TABLE mcp_download_links ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(group_id) ON DELETE CASCADE;
ALTER TABLE mcp_download_links ALTER COLUMN file_name DROP NOT NULL;

ALTER TABLE mcp_download_links DROP CONSTRAINT IF EXISTS mcp_download_links_kind_check;
ALTER TABLE mcp_download_links DROP CONSTRAINT IF EXISTS mcp_download_links_kind_shape;

ALTER TABLE mcp_download_links
  ADD CONSTRAINT mcp_download_links_kind_check
    CHECK (kind IN ('lesson_file', 'assessment_class_feedback')),
  ADD CONSTRAINT mcp_download_links_kind_shape CHECK (
    CASE kind
      WHEN 'lesson_file' THEN file_name IS NOT NULL AND group_id IS NULL
      ELSE activity_id IS NOT NULL AND group_id IS NOT NULL AND file_name IS NULL
    END
  );

COMMIT;
