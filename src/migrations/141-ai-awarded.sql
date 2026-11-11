-- 141-ai-awarded.sql
--
-- Keep the AI marker's own mark on each criterion of an assessment paper
-- (132, 134) beside the mark that stands. A teacher's change of mark
-- overwrites `awarded` and drops the marker's comment, so until now the AI's
-- mark was lost. `ai_awarded` is set whenever the marker writes a row and is
-- never touched by a teacher (store.ts writeCriterionMarks), so the class
-- feedback PDF (a teacher copy) can show each pupil's marks before and after
-- the teacher's changes. Null means the AI never marked the criterion, or its
-- mark is not known: legacy rows, and teacher marks with nothing to recover.
--
-- Backfill, only where ai_awarded is still null:
--   1. 'ai' rows: the mark is the marker's.
--   2. 'teacher' rows, from the most recent finished ai_mark job of that
--      submission and question whose model_response holds the criterion
--      (marking.ts records {criteria: [{successCriteriaId, awarded, ...}]}).
--   3. 'teacher' rows that still carry the marker's comment, on a paper not
--      folded in from the old module: the store drops that comment when a
--      teacher changes the mark, so the mark is still the marker's (a
--      confirmed or unchanged row).
--   4. 'teacher' rows on a question read as blank (not teacher-only), changed
--      no earlier than the answer was stored: the read gave those criteria 0
--      (completeAssessmentRead).
-- A recovered mark outside 0..available (the allocations changed since) is
-- left null.

BEGIN;

ALTER TABLE submission_question_criterion_marks
  ADD COLUMN IF NOT EXISTS ai_awarded integer;

ALTER TABLE submission_question_criterion_marks
  DROP CONSTRAINT IF EXISTS submission_question_criterion_marks_ai_awarded_check;
ALTER TABLE submission_question_criterion_marks
  ADD CONSTRAINT submission_question_criterion_marks_ai_awarded_check
    CHECK (ai_awarded IS NULL OR (ai_awarded >= 0 AND ai_awarded <= available));

-- 1.
UPDATE submission_question_criterion_marks
   SET ai_awarded = awarded
 WHERE provenance = 'ai' AND ai_awarded IS NULL;

-- 2.
WITH latest_job AS (
  SELECT DISTINCT ON (j.payload->>'submissionId', j.payload->>'questionId')
         j.payload->>'submissionId' AS submission_id,
         j.payload->>'questionId' AS question_id,
         j.model_response
    FROM external_jobs j
   WHERE j.job_type = 'ai_mark'
     AND j.status = 'done'
     AND j.payload ? 'questionId'
     AND j.model_response IS NOT NULL
     AND jsonb_typeof(j.model_response->'criteria') = 'array'
   ORDER BY j.payload->>'submissionId', j.payload->>'questionId', j.updated_at DESC, j.job_id DESC
),
recovered AS (
  SELECT lj.submission_id, lj.question_id, c->>'successCriteriaId' AS success_criteria_id,
         (c->>'awarded')::int AS awarded
    FROM latest_job lj
    CROSS JOIN LATERAL jsonb_array_elements(lj.model_response->'criteria') c
   WHERE jsonb_typeof(c->'awarded') = 'number'
     AND (c->>'awarded') ~ '^[0-9]+$'
)
UPDATE submission_question_criterion_marks m
   SET ai_awarded = r.awarded
  FROM recovered r
 WHERE m.provenance = 'teacher' AND m.ai_awarded IS NULL
   AND m.submission_id = r.submission_id
   AND m.question_id::text = r.question_id
   AND m.success_criteria_id = r.success_criteria_id
   AND r.awarded BETWEEN 0 AND m.available;

-- 3.
UPDATE submission_question_criterion_marks m
   SET ai_awarded = m.awarded
  FROM submissions s
  JOIN activities a ON a.activity_id = s.activity_id
 WHERE m.provenance = 'teacher' AND m.ai_awarded IS NULL
   AND s.submission_id = m.submission_id
   AND NOT (coalesce(a.body_data, '{}'::jsonb) ? 'foldedFromAssessmentIds')
   AND (nullif(btrim(coalesce(m.why_not_awarded, '')), '') IS NOT NULL
        OR nullif(btrim(coalesce(m.how_to_improve, '')), '') IS NOT NULL);

-- 4.
UPDATE submission_question_criterion_marks m
   SET ai_awarded = 0
  FROM submission_question_answers ans, activity_questions q
 WHERE m.provenance = 'teacher' AND m.ai_awarded IS NULL
   AND ans.submission_id = m.submission_id AND ans.question_id = m.question_id
   AND ans.status = 'blank'
   -- The 0 is written with the answer, in the read's transaction; a teacher
   -- row older than the answer was marked before the read and never got it.
   AND m.updated_at >= ans.updated_at
   AND q.question_id = m.question_id AND q.marking <> 'teacher';

COMMIT;
