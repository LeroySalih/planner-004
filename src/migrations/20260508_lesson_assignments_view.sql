-- Step 1: Seed timetable defaults for Leroy Salih.
-- Matches on both dev (leroy@mr-salih.org) and production (leroysalih@bisak.org) emails.
-- These are the canonical timetable slots as of 24 May 2026.
-- ON CONFLICT DO NOTHING — safe to re-run; won't overwrite teacher's own changes.
INSERT INTO timetable_slot_groups (teacher_id, day, period, group_id)
SELECT p.user_id, v.day, v.period, v.group_id
FROM (VALUES
  ('sunday',    1, '25-10-DT'),
  ('sunday',    2, '25-8C-DT'),
  ('sunday',    4, '25-8B-DT'),
  ('sunday',    6, '25-9C-DT'),
  ('sunday',    7, '25-10-DT'),
  ('monday',    1, '25-9A-DT'),
  ('monday',    2, '25-8D-IT'),
  ('monday',    4, '25-7D-DT'),
  ('monday',    5, '25-11-DT'),
  ('tuesday',   3, '25-9D-DT'),
  ('tuesday',   4, '25-10-DT'),
  ('tuesday',   6, '25-11-DT'),
  ('wednesday', 2, '25-11-DT'),
  ('wednesday', 3, '25-7C-DT'),
  ('wednesday', 4, '25-7A-DT'),
  ('wednesday', 5, '25-7B-IT'),
  ('thursday',  3, '25-10-DT'),
  ('thursday',  4, '25-9B-DT'),
  ('thursday',  5, '25-8A-DT')
) AS v(day, period, group_id)
JOIN profiles p ON lower(p.email) IN ('leroy@mr-salih.org', 'leroysalih@bisak.org')
ON CONFLICT (teacher_id, day, period) DO NOTHING;

-- Step 2: Replace UNIQUE constraint on planner_assignments
-- Old: (group_id, week_start_date, day, period) — one lesson per slot
-- New: (group_id, week_start_date, day, period, lesson_id) — many lessons per slot
ALTER TABLE planner_assignments
  DROP CONSTRAINT IF EXISTS planner_assignments_group_id_week_start_date_day_period_key,
  ADD CONSTRAINT planner_assignments_group_lesson_slot_unique
    UNIQUE (group_id, week_start_date, day, period, lesson_id);

-- Step 3: Migrate existing lesson_assignments rows into planner_assignments.
-- Each row is placed in the earliest timetable slot for that group.
-- Groups with no timetable_slot_groups entry fall back to sunday / period 1
-- so no assignments are lost on re-run.
INSERT INTO planner_assignments (group_id, lesson_id, week_start_date, day, period)
SELECT
  la.group_id,
  la.lesson_id,
  (la.start_date - EXTRACT(DOW FROM la.start_date)::int * INTERVAL '1 day')::date AS week_start_date,
  COALESCE(first_slot.day,    'sunday') AS day,
  COALESCE(first_slot.period, 1)        AS period
FROM lesson_assignments la
LEFT JOIN (
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

-- Step 4: Drop the old table and create view of same name
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
