-- 143-powerpoint-assessment.sql
--
-- A PowerPoint assessment ('powerpoint-assessment') is a question-marked
-- activity like an assessment paper (132): its questions split their marks
-- across success criteria, and the same store derives the submission's
-- totals. What differs is the work handed in: instead of one scanned script,
-- a pupil hands in named files (a presentation, PDFs, an evidence document),
-- one per upload slot. These are read in-app, without a model, and each
-- question is then marked from the evidence its `evidence` spec names.
--
--   * is_question_marked_activity_type and is_scorable_activity_type gain the
--     type (keep in step with src/dino.config.ts).
--   * activity_questions.evidence: per question, where its evidence comes from
--     (validated in TypeScript; '[]' for an assessment paper).
--   * practical_supplied_images: the images the task supplies, fingerprinted
--     so the presentation reader can recognise them in a pupil's file.
--   * practical_submission_files: each pupil's file per slot.
--   * practical_submission_evidence: what was read from each file.
--   * submission_question_answers.marker_evidence: the marker's note on what
--     it saw. Teacher-only, never shown to pupils.
--   * mcp_upload_links: upload kinds for a supplied image and a pupil's file.
--   * ai_model_routes: the per-question mark is routed at /admin/ai-models.

BEGIN;

-- Keep in step with QUESTION_MARKED_ACTIVITY_TYPES in src/dino.config.ts.
CREATE OR REPLACE FUNCTION is_question_marked_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_type, ''))) = ANY (ARRAY['assessment-paper', 'powerpoint-assessment'])
$$;

-- Keep in step with SCORABLE_ACTIVITY_TYPES in src/dino.config.ts.
CREATE OR REPLACE FUNCTION is_scorable_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_type, ''))) = ANY (ARRAY[
    'multiple-choice-question', 'short-text-question', 'text-question',
    'long-text-question', 'upload-file', 'upload-url', 'upload-spreadsheet',
    'upload-code', 'upload-worksheet', 'mark-worksheet', 'feedback',
    'sketch-render', 'do-flashcards', 'matcher', 'group-items', 'voice',
    'sequence', 'assessment-paper', 'powerpoint-assessment'
  ])
$$;

ALTER TABLE activity_questions
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE activity_questions DROP CONSTRAINT IF EXISTS activity_questions_evidence_check;
ALTER TABLE activity_questions
  ADD CONSTRAINT activity_questions_evidence_check CHECK (jsonb_typeof(evidence) = 'array');

-- Stored in the lessons bucket at
-- lessons/{lessonId}/activities/{activityId}/images/{file_name}.
CREATE TABLE IF NOT EXISTS practical_supplied_images (
  activity_id text NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  fingerprint text NOT NULL,
  width integer,
  height integer,
  uploaded_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (activity_id, name)
);

-- Supplied images are lesson content, so changing them makes the unit's
-- audit stale (migration 123).
DROP TRIGGER IF EXISTS unit_audits_practical_supplied_images ON practical_supplied_images;
CREATE TRIGGER unit_audits_practical_supplied_images
  AFTER INSERT OR DELETE OR UPDATE ON practical_supplied_images
  FOR EACH ROW EXECUTE FUNCTION unit_audits_on_change('activity');

-- Stored in the assessment-scripts bucket at
-- {activityId}/practical/{fileId}/original.{pptx|pdf|docx}. One file per slot
-- per submission: a re-upload replaces it.
CREATE TABLE IF NOT EXISTS practical_submission_files (
  file_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id text NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
  pupil_id text NOT NULL,
  submission_id text NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  slot_key text NOT NULL CHECK (slot_key ~ '^[a-z0-9-]+$'),
  original_name text NOT NULL,
  storage_path text NOT NULL,
  bytes integer NOT NULL CHECK (bytes >= 0),
  sha256 text NOT NULL,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (submission_id, slot_key)
);
CREATE INDEX IF NOT EXISTS practical_submission_files_activity_pupil_idx
  ON practical_submission_files (activity_id, pupil_id);

-- What the reader got from each file. cache_key is the file's sha256, the
-- supplied images' hash and the reader's version, so an unchanged file is
-- not read again.
CREATE TABLE IF NOT EXISTS practical_submission_evidence (
  file_id uuid PRIMARY KEY REFERENCES practical_submission_files(file_id) ON DELETE CASCADE,
  submission_id text NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('presentation', 'pdf', 'evidence_doc')),
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  error text,
  cache_key text NOT NULL,
  report jsonb,
  description text,
  image_paths text[] NOT NULL DEFAULT '{}',
  extracted_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS practical_submission_evidence_submission_idx
  ON practical_submission_evidence (submission_id);

ALTER TABLE submission_question_answers ADD COLUMN IF NOT EXISTS marker_evidence text;

-- Upload links: a supplied image names no pupil; a pupil's file names its
-- pupil and its slot. Only a script or a pupil's file names a pupil, and only
-- a pupil's file names a slot.
ALTER TABLE mcp_upload_links ADD COLUMN IF NOT EXISTS slot_key text;

ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_target_shape;
ALTER TABLE mcp_upload_links DROP CONSTRAINT IF EXISTS mcp_upload_links_upload_kind_check;

ALTER TABLE mcp_upload_links
  ADD CONSTRAINT mcp_upload_links_upload_kind_check
    CHECK (upload_kind IS NULL OR upload_kind IN
      ('question_paper', 'mark_scheme', 'script', 'supplied_image', 'practical_file')),
  ADD CONSTRAINT mcp_upload_links_target_shape CHECK (
    CASE target
      WHEN 'activity' THEN lesson_id IS NOT NULL AND activity_id IS NOT NULL AND assessment_id IS NULL
                           AND upload_kind IS NULL AND slot_key IS NULL
      WHEN 'lesson' THEN lesson_id IS NOT NULL AND activity_id IS NULL AND assessment_id IS NULL
                         AND upload_kind IS NULL AND slot_key IS NULL
      WHEN 'assessment' THEN lesson_id IS NULL AND activity_id IS NULL AND assessment_id IS NOT NULL
                             AND upload_kind IS NULL AND slot_key IS NULL
      ELSE lesson_id IS NOT NULL AND activity_id IS NOT NULL AND assessment_id IS NULL
           AND upload_kind IS NOT NULL
           AND ((upload_kind IN ('script', 'practical_file')) = (pupil_id IS NOT NULL))
           AND ((upload_kind = 'practical_file') = (slot_key IS NOT NULL))
    END
  );

-- The per-question mark is routed like the other AI-marked types. It starts
-- on the assessment paper's provider and model, or on Claude Sonnet 5 when
-- that has no route. No existing route is changed.
INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'powerpoint-assessment', NULL,
       coalesce(r.provider, 'anthropic'), coalesce(r.model, 'claude-sonnet-5'), r.effort, 'migration-143'
  FROM (SELECT 1) one
  LEFT JOIN ai_model_routes r ON r.activity_type = 'assessment-paper' AND r.sc_type IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM ai_model_routes
                    WHERE activity_type = 'powerpoint-assessment' AND sc_type IS NULL);

COMMIT;
