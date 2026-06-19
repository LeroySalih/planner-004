-- Backfill sow_lesson_plan from existing planner_assignments.
-- Safe to re-run: ON CONFLICT DO NOTHING.
INSERT INTO sow_lesson_plan (group_id, lesson_id, unit_id, week_start_date)
SELECT DISTINCT
  pa.group_id,
  pa.lesson_id,
  l.unit_id,
  pa.week_start_date::date
FROM planner_assignments pa
JOIN lessons l ON l.lesson_id = pa.lesson_id
ON CONFLICT (group_id, lesson_id, week_start_date) DO NOTHING;
