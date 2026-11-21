-- create_assessment_activity_file_upload_link uploads every file an
-- assessment activity uses, with an optional re-mark after the upload.
--
--   * upload_kind: three new kinds, a practical assessment's own activity
--     files: 'evidence_template' (the blank evidence .docx),
--     'starting_database' (a database assessment's .accdb) and
--     'reference_file' (a file a question's reference_file evidence names,
--     stored under file_name, which it requires).
--   * remark: null = the kind's default (whole-activity kinds: no re-mark; a
--     pupil's script or practical file: sent for marking as usual), true =
--     re-mark after the upload, false = (pupil kinds) stored and cleared,
--     nothing sent.
--   * remark_questions: only these question labels are re-marked; never with
--     remark false, never empty.
--
-- Both are only for assessment-activity links. The rest of the target shape
-- is migration 143's.

BEGIN;

ALTER TABLE mcp_upload_links ADD COLUMN IF NOT EXISTS remark boolean;
ALTER TABLE mcp_upload_links ADD COLUMN IF NOT EXISTS remark_questions text[];

ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_target_shape;
ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_upload_kind_check;

ALTER TABLE mcp_upload_links
  ADD CONSTRAINT mcp_upload_links_upload_kind_check
    CHECK (upload_kind IS NULL OR upload_kind IN
      ('question_paper', 'mark_scheme', 'script', 'supplied_image', 'practical_file',
       'evidence_template', 'starting_database', 'reference_file')),
  ADD CONSTRAINT mcp_upload_links_target_shape CHECK (
    CASE target
      WHEN 'activity' THEN lesson_id IS NOT NULL AND activity_id IS NOT NULL AND assessment_id IS NULL
                           AND upload_kind IS NULL AND slot_key IS NULL
                           AND remark IS NULL AND remark_questions IS NULL
      WHEN 'lesson' THEN lesson_id IS NOT NULL AND activity_id IS NULL AND assessment_id IS NULL
                         AND upload_kind IS NULL AND slot_key IS NULL
                         AND remark IS NULL AND remark_questions IS NULL
      WHEN 'assessment' THEN lesson_id IS NULL AND activity_id IS NULL AND assessment_id IS NOT NULL
                             AND upload_kind IS NULL AND slot_key IS NULL
                             AND remark IS NULL AND remark_questions IS NULL
      ELSE lesson_id IS NOT NULL AND activity_id IS NOT NULL AND assessment_id IS NULL
           AND upload_kind IS NOT NULL
           AND ((upload_kind IN ('script', 'practical_file')) = (pupil_id IS NOT NULL))
           AND ((upload_kind = 'practical_file') = (slot_key IS NOT NULL))
           AND (upload_kind <> 'reference_file' OR file_name IS NOT NULL)
           AND (remark_questions IS NULL OR (cardinality(remark_questions) > 0 AND remark IS DISTINCT FROM false))
    END
  );

COMMIT;
