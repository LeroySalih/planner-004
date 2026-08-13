-- 081-multi-sc.sql
-- Per-success-criterion marking.
--
-- Every SC becomes binary (0-1) or levelled (0-n ascending descriptors).
-- Activities fan out one model call per SC; results land in submission_sc_marks
-- and are summed into the activity score.
--
-- See docs/plans/2026-08-08-multi-sc-marking.md and
-- docs/plans/multi-sc-open-questions.md.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. SC type
-- ---------------------------------------------------------------------------

-- NOTE: success_criteria.level already exists and is the criterion's own
-- attainment level (the [L3] notation from the curriculum builder). It is NOT
-- the descriptor count. Do not overload it.
ALTER TABLE success_criteria
  ADD COLUMN IF NOT EXISTS sc_type text NOT NULL DEFAULT 'binary';

ALTER TABLE success_criteria
  DROP CONSTRAINT IF EXISTS success_criteria_sc_type_check;

ALTER TABLE success_criteria
  ADD CONSTRAINT success_criteria_sc_type_check
  CHECK (sc_type IN ('binary', 'levelled'));

-- ---------------------------------------------------------------------------
-- 2. Levelled descriptors
-- ---------------------------------------------------------------------------

-- level_index runs 1..n in ascending order of demand. A pupil scores 0 (no
-- descriptor met) through n (top descriptor met), so a levelled SC contributes
-- n marks and has n+1 possible outcomes.
CREATE TABLE IF NOT EXISTS success_criteria_descriptors (
  success_criteria_id text NOT NULL
    REFERENCES success_criteria(success_criteria_id) ON DELETE CASCADE,
  level_index         integer NOT NULL CHECK (level_index >= 1),
  descriptor          text NOT NULL,
  PRIMARY KEY (success_criteria_id, level_index)
);

-- ---------------------------------------------------------------------------
-- 3. Per-criterion marks
-- ---------------------------------------------------------------------------

-- Authoritative store for per-criterion results. The aggregate written to
-- submissions.body is a cache derived from these rows.
--
-- provenance:
--   'ai'      - real per-criterion assessment from the marking flow
--   'teacher' - manual override; must survive a re-mark
--   'legacy'  - migrated pre-cutover uniform fill, NOT a real assessment
CREATE TABLE IF NOT EXISTS submission_sc_marks (
  submission_id       text NOT NULL,
  success_criteria_id text NOT NULL
    REFERENCES success_criteria(success_criteria_id) ON DELETE CASCADE,
  awarded             integer NOT NULL CHECK (awarded >= 0),
  available           integer NOT NULL CHECK (available >= 1),
  feedback            text,
  provenance          text NOT NULL DEFAULT 'ai'
    CHECK (provenance IN ('ai', 'teacher', 'legacy')),
  marked_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (submission_id, success_criteria_id),
  CONSTRAINT submission_sc_marks_awarded_within_available
    CHECK (awarded <= available)
);

CREATE INDEX IF NOT EXISTS idx_submission_sc_marks_sc
  ON submission_sc_marks (success_criteria_id, submission_id);

-- ---------------------------------------------------------------------------
-- 4. Backfill legacy per-SC data
-- ---------------------------------------------------------------------------

-- Existing body.success_criteria_scores holds normalised 0-1 values, uniform
-- filled with the submission's overall score. Every SC is 'binary' at this
-- point (column default), so available = 1 and awarded = round(score).
--
-- The success_criteria_id guard is required: the FK would otherwise reject rows
-- referencing criteria deleted since the submission was marked.
INSERT INTO submission_sc_marks
  (submission_id, success_criteria_id, awarded, available, provenance, marked_at)
SELECT
  s.submission_id,
  kv.key,
  LEAST(1, GREATEST(0, ROUND((kv.value #>> '{}')::numeric)))::integer,
  1,
  'legacy',
  COALESCE(s.submitted_at, timezone('utc', now()))
FROM submissions s
CROSS JOIN LATERAL jsonb_each((s.body::jsonb) -> 'success_criteria_scores') AS kv
WHERE s.body IS NOT NULL
  AND (s.body::jsonb) ? 'success_criteria_scores'
  AND jsonb_typeof((s.body::jsonb) -> 'success_criteria_scores') = 'object'
  AND jsonb_typeof(kv.value) = 'number'
  AND kv.key IN (SELECT success_criteria_id FROM success_criteria)
ON CONFLICT (submission_id, success_criteria_id) DO NOTHING;

COMMIT;
