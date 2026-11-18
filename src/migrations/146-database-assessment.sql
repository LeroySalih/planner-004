-- 146-database-assessment.sql
--
-- A database assessment ('database-assessment') is a practical activity like
-- a PowerPoint assessment (143): a pupil hands in named files, one per upload
-- slot (a Microsoft Access .accdb database and an EVIDENCE .docx), which are
-- read in-app without a model, and each question is then marked from the
-- evidence its `evidence` spec names. The practical tables from 143 are
-- shared; only the reader and the marker's texts differ.
--
--   * is_question_marked_activity_type and is_scorable_activity_type gain the
--     type (keep in step with src/dino.config.ts).
--   * practical_submission_evidence.kind gains 'database': what was read from
--     a pupil's .accdb (src/lib/accdb).
--   * ai_model_routes: the per-question mark is routed at /admin/ai-models,
--     starting on the PowerPoint assessment's route.
--
-- mcp_upload_links needs nothing: the 'practical_file' kind and slot_key are
-- already generic.

BEGIN;

-- Keep in step with QUESTION_MARKED_ACTIVITY_TYPES in src/dino.config.ts.
CREATE OR REPLACE FUNCTION is_question_marked_activity_type(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_type, ''))) = ANY (ARRAY['assessment-paper', 'powerpoint-assessment', 'database-assessment'])
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
    'sequence', 'assessment-paper', 'powerpoint-assessment', 'database-assessment'
  ])
$$;

ALTER TABLE practical_submission_evidence DROP CONSTRAINT IF EXISTS practical_submission_evidence_kind_check;

ALTER TABLE practical_submission_evidence
  ADD CONSTRAINT practical_submission_evidence_kind_check
    CHECK (kind IN ('presentation', 'pdf', 'evidence_doc', 'database'));

INSERT INTO ai_model_routes (activity_type, sc_type, provider, model, effort, updated_by)
SELECT 'database-assessment', NULL,
       coalesce(pp.provider, ap.provider, 'anthropic'),
       coalesce(pp.model, ap.model, 'claude-sonnet-5'),
       CASE WHEN pp.activity_type IS NOT NULL THEN pp.effort ELSE ap.effort END,
       'migration-146'
  FROM (SELECT 1) one
  LEFT JOIN ai_model_routes pp ON pp.activity_type = 'powerpoint-assessment' AND pp.sc_type IS NULL
  LEFT JOIN ai_model_routes ap ON ap.activity_type = 'assessment-paper' AND ap.sc_type IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM ai_model_routes
                    WHERE activity_type = 'database-assessment' AND sc_type IS NULL);

COMMIT;
