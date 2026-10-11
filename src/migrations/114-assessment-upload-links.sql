-- 114-assessment-upload-links.sql
--
-- One-time upload links (107) can now point at an assessment paper, so Claude
-- can send scans of pupils' marked papers from its code sandbox straight to
-- the paper's teacher-only file store. Scans are usually far too large to pass
-- through a tool call as base64.

BEGIN;

ALTER TABLE mcp_upload_links
  ADD COLUMN IF NOT EXISTS assessment_id uuid REFERENCES assessments(assessment_id) ON DELETE CASCADE;

ALTER TABLE mcp_upload_links ALTER COLUMN lesson_id DROP NOT NULL;

ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_target_check;
ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_check;
ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_target_shape;

ALTER TABLE mcp_upload_links
  ADD CONSTRAINT mcp_upload_links_target_check CHECK (target IN ('activity', 'lesson', 'assessment')),
  ADD CONSTRAINT mcp_upload_links_target_shape CHECK (
    CASE target
      WHEN 'activity' THEN lesson_id IS NOT NULL AND activity_id IS NOT NULL AND assessment_id IS NULL
      WHEN 'lesson' THEN lesson_id IS NOT NULL AND activity_id IS NULL AND assessment_id IS NULL
      ELSE lesson_id IS NULL AND activity_id IS NULL AND assessment_id IS NOT NULL
    END
  );

COMMIT;
