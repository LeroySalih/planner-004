-- Step 1: Replace UNIQUE constraint on planner_assignments
-- Old: (group_id, week_start_date, day, period) — one lesson per slot
-- New: (group_id, week_start_date, day, period, lesson_id) — many lessons per slot
ALTER TABLE planner_assignments
  DROP CONSTRAINT IF EXISTS planner_assignments_group_id_week_start_date_day_period_key,
  ADD CONSTRAINT planner_assignments_group_lesson_slot_unique
    UNIQUE (group_id, week_start_date, day, period, lesson_id);

-- Step 2: Migrate existing lesson_assignments rows into planner_assignments
-- Each row is placed in the first timetable slot of its week for that group.
-- Groups with no entry in timetable_slot_groups are silently skipped.
INSERT INTO planner_assignments (group_id, lesson_id, week_start_date, day, period)
SELECT
  la.group_id,
  la.lesson_id,
  (la.start_date - EXTRACT(DOW FROM la.start_date)::int * INTERVAL '1 day')::date AS week_start_date,
  first_slot.day,
  first_slot.period
FROM lesson_assignments la
JOIN (
  SELECT DISTINCT ON (group_id) group_id, day, period
  FROM timetable_slot_groups
  ORDER BY
    group_id,
    CASE day
      WHEN 'sunday'    THEN 0
      WHEN 'monday'    THEN 1
      WHEN 'tuesday'   THEN 2
      WHEN 'wednesday' THEN 3
      WHEN 'thursday'  THEN 4
      ELSE 5
    END,
    period
) first_slot ON first_slot.group_id = la.group_id
ON CONFLICT DO NOTHING;

-- Step 3: Drop the old table and create view of same name
DROP TABLE lesson_assignments;

CREATE VIEW lesson_assignments AS
SELECT
  group_id,
  lesson_id,
  MIN(week_start_date)::date  AS start_date,
  FALSE                       AS hidden,
  FALSE                       AS locked,
  BOOL_OR(feedback_visible)   AS feedback_visible
FROM planner_assignments
GROUP BY group_id, lesson_id;
