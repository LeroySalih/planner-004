-- 073-multi-sc-backfill.sql
--
-- Data backfill for per-criterion marking. Requires 072-multi-sc.sql.
--
-- Two steps, both idempotent:
--
--   1. Preserve short-text-question granularity. 286 STQs are marked out of 3
--      today (the STQ default in lesson-activities.ts) but carry a single
--      binary criterion. Deriving max_marks would drop them to pass/fail, so
--      the criteria involved are converted to levelled with 3 placeholder
--      descriptors that teachers then rewrite.
--
--   2. Backfill activities.max_marks from the criteria, applying the two
--      qualifying rules: deterministic types cap at 1, non-scorable types are
--      excluded. These rules must stay in step with
--      src/lib/scoring/derive-max-marks.ts and DETERMINISTIC_ACTIVITY_TYPES /
--      NON_SCORABLE_ACTIVITY_TYPES in src/dino.config.ts.
--
-- The descriptors written here are PLACEHOLDERS. They exist to preserve the
-- 3-mark ceiling; they are not real assessment criteria and must be rewritten
-- in the curriculum builder before they carry pedagogical weight.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Convert the criteria behind 3-mark short-text-questions to levelled(3)
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE scs_to_convert ON COMMIT DROP AS
SELECT DISTINCT acs.success_criteria_id
FROM activity_success_criteria acs
JOIN activities a ON a.activity_id = acs.activity_id
WHERE a.type = 'short-text-question'
  AND a.max_marks = 3
  AND (
    SELECT count(*) FROM activity_success_criteria x
    WHERE x.activity_id = acs.activity_id
  ) = 1
  -- only criteria still binary and carrying no descriptors, so re-running is safe
  AND EXISTS (
    SELECT 1 FROM success_criteria sc
    WHERE sc.success_criteria_id = acs.success_criteria_id
      AND sc.sc_type = 'binary'
  )
  AND NOT EXISTS (
    SELECT 1 FROM success_criteria_descriptors d
    WHERE d.success_criteria_id = acs.success_criteria_id
  );

UPDATE success_criteria sc
SET sc_type = 'levelled'
FROM scs_to_convert c
WHERE sc.success_criteria_id = c.success_criteria_id;

INSERT INTO success_criteria_descriptors (success_criteria_id, level_index, descriptor)
SELECT c.success_criteria_id, v.level_index, v.descriptor
FROM scs_to_convert c
CROSS JOIN (VALUES
  (1, 'PLACEHOLDER — partially meets the criterion. Rewrite in the curriculum builder.'),
  (2, 'PLACEHOLDER — largely meets the criterion. Rewrite in the curriculum builder.'),
  (3, 'PLACEHOLDER — fully meets the criterion. Rewrite in the curriculum builder.')
) AS v(level_index, descriptor)
ON CONFLICT (success_criteria_id, level_index) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Backfill activities.max_marks
-- ---------------------------------------------------------------------------

UPDATE activities a
SET max_marks = totals.available
FROM (
  SELECT acs.activity_id,
         CASE
           WHEN act.type IN (
             'multiple-choice-question', 'matcher', 'sequence',
             'group-items', 'do-flashcards'
           ) THEN 1
           ELSE sum(
             CASE WHEN sc.sc_type = 'levelled'
                  THEN greatest(1, (
                    SELECT count(*) FROM success_criteria_descriptors d
                    WHERE d.success_criteria_id = sc.success_criteria_id
                  ))
                  ELSE 1
             END
           )::int
         END AS available
  FROM activity_success_criteria acs
  JOIN success_criteria sc ON sc.success_criteria_id = acs.success_criteria_id
  JOIN activities act ON act.activity_id = acs.activity_id
  WHERE act.type NOT IN (
    'text', 'display-image', 'display-webpage', 'display-flashcards',
    'file-download', 'show-video', 'share-my-work', 'review-others-work',
    'display-section'
  )
  GROUP BY acs.activity_id, act.type
) totals
WHERE a.activity_id = totals.activity_id
  AND a.max_marks IS DISTINCT FROM totals.available;

-- ---------------------------------------------------------------------------
-- 3. Correct the legacy per-criterion marks for the converted criteria
-- ---------------------------------------------------------------------------

-- 072 wrote every legacy row as available=1 because all criteria were binary
-- at that point. The rows for criteria just converted to levelled(3) must be
-- rescaled or they will violate the marking model (a levelled(3) criterion
-- reports out of 3, not 1).
UPDATE submission_sc_marks m
SET available = 3,
    awarded = m.awarded * 3
FROM scs_to_convert c
WHERE m.success_criteria_id = c.success_criteria_id
  AND m.provenance = 'legacy'
  AND m.available = 1;

COMMIT;
