-- 103-group-items-partial-credit.sql
--
-- A grouping activity already worked out how much of it a pupil got right —
-- the submission records `score` as correct/total — but nothing ever wrote
-- `marks`. Every marks-based reader, the results grid included, therefore saw
-- the submission as unmarked however well the pupil had done: a pupil who
-- placed all eight items correctly showed as "—", and the column averaged 0%.
--
-- So, as migration 101 did for matching: one mark per correctly placed item,
-- max_marks is the item count rather than the 1 every deterministic type was
-- capped at, and the existing submissions are rescored from the placements
-- they already hold.
--
-- No change is needed to compute_submission_marks: group-items falls to the
-- generic branch, which reads `marks` and simply found nothing there.

BEGIN;

-- Rescore one grouping activity's submissions from their stored placements.
CREATE OR REPLACE FUNCTION recompute_group_items_submission_marks(p_activity_id text)
RETURNS integer AS $$
DECLARE
  item_count integer;
  touched integer;
BEGIN
  SELECT jsonb_array_length(a.body_data::jsonb->'items')
  INTO item_count
  FROM activities a
  WHERE a.activity_id = p_activity_id AND a.type = 'group-items';

  IF item_count IS NULL OR item_count = 0 THEN
    RETURN 0;
  END IF;

  WITH scored AS (
    SELECT s.submission_id,
           (
             SELECT count(*)
             FROM jsonb_array_elements(a.body_data::jsonb->'items') item
             WHERE s.body::jsonb->'placements'->>(item->>'id') = item->>'groupId'
           )::int AS awarded
    FROM submissions s
    JOIN activities a ON a.activity_id = s.activity_id
    WHERE s.activity_id = p_activity_id
      AND s.body::jsonb ? 'placements'
  )
  UPDATE submissions s
  SET body = jsonb_set(
        jsonb_set(
          jsonb_set(s.body::jsonb, '{marks}', to_jsonb(scored.awarded), true),
          '{score}', to_jsonb(round(scored.awarded::numeric / item_count, 6)), true
        ),
        '{is_correct}', to_jsonb(scored.awarded = item_count), true
      )::json
  FROM scored
  WHERE s.submission_id = scored.submission_id;

  GET DIAGNOSTICS touched = ROW_COUNT;

  -- Criterion marks follow the same fraction. Teacher marks are never touched.
  UPDATE submission_sc_marks m
  SET awarded = round(
        (
          SELECT count(*)
          FROM jsonb_array_elements(a.body_data::jsonb->'items') item
          WHERE s.body::jsonb->'placements'->>(item->>'id') = item->>'groupId'
        )::numeric / item_count * m.available
      )::int
  FROM submissions s
  JOIN activities a ON a.activity_id = s.activity_id
  WHERE s.submission_id = m.submission_id
    AND s.activity_id = p_activity_id
    AND s.body::jsonb ? 'placements'
    AND m.provenance <> 'teacher';

  RETURN touched;
END;
$$ LANGUAGE plpgsql;

-- max_marks becomes the item count, then every submission rescores.
UPDATE activities a
SET max_marks = greatest(1, jsonb_array_length(a.body_data::jsonb->'items'))
WHERE a.type = 'group-items'
  AND a.body_data::jsonb ? 'items'
  AND a.max_marks IS DISTINCT FROM greatest(1, jsonb_array_length(a.body_data::jsonb->'items'));

SELECT recompute_group_items_submission_marks(a.activity_id)
FROM activities a
WHERE a.type = 'group-items' AND a.body_data::jsonb ? 'items';

COMMIT;
