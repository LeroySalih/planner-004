-- 133-assessment-activity-upload-links.sql
--
-- One-time upload links (107, 114) can now point at an assessment-paper
-- activity (132), for its question paper, its mark scheme, or one pupil's
-- script. upload_kind says which. A script link names its pupil; the paper
-- files never do.

BEGIN;

ALTER TABLE mcp_upload_links ADD COLUMN IF NOT EXISTS upload_kind text;

ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_target_check;
ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_target_shape;
ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_upload_kind_check;

ALTER TABLE mcp_upload_links
  ADD CONSTRAINT mcp_upload_links_target_check
    CHECK (target IN ('activity', 'lesson', 'assessment', 'assessment-activity')),
  ADD CONSTRAINT mcp_upload_links_upload_kind_check
    CHECK (upload_kind IS NULL OR upload_kind IN ('question_paper', 'mark_scheme', 'script')),
  ADD CONSTRAINT mcp_upload_links_target_shape CHECK (
    CASE target
      WHEN 'activity' THEN lesson_id IS NOT NULL AND activity_id IS NOT NULL AND assessment_id IS NULL
                           AND upload_kind IS NULL
      WHEN 'lesson' THEN lesson_id IS NOT NULL AND activity_id IS NULL AND assessment_id IS NULL
                         AND upload_kind IS NULL
      WHEN 'assessment' THEN lesson_id IS NULL AND activity_id IS NULL AND assessment_id IS NOT NULL
                             AND upload_kind IS NULL
      ELSE lesson_id IS NOT NULL AND activity_id IS NOT NULL AND assessment_id IS NULL
           AND upload_kind IS NOT NULL AND ((upload_kind = 'script') = (pupil_id IS NOT NULL))
    END
  );

COMMIT;
