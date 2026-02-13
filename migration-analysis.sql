-- Migration Analysis: Can we migrate lesson-level feedback to activity-level with zero data loss?

-- CHALLENGE 1: Map lesson-level feedback to activities
-- Current: feedback(user_id, lesson_id, success_criteria_id, rating)
-- Target: activity_feedback(activity_id, pupil_id, success_criteria_id, rating)

-- For each feedback entry, we need to find matching activities:
-- Q1: How many feedback entries exist?
-- Q2: How many can be mapped to activities that use the same SC?
-- Q3: How many would be orphaned (no matching activity)?

-- Analysis query:
WITH feedback_with_activities AS (
  SELECT
    f.id,
    f.user_id,
    f.lesson_id,
    f.success_criteria_id,
    f.rating,
    a.activity_id,
    asc.success_criteria_id as activity_sc_id
  FROM feedback f
  LEFT JOIN activities a ON a.lesson_id = f.lesson_id
  LEFT JOIN activity_success_criteria asc
    ON asc.activity_id = a.activity_id
    AND asc.success_criteria_id = f.success_criteria_id
)
SELECT
  COUNT(DISTINCT id) as total_feedback_entries,
  COUNT(DISTINCT CASE WHEN activity_id IS NOT NULL AND activity_sc_id IS NOT NULL
                      THEN id END) as mappable_to_activities,
  COUNT(DISTINCT CASE WHEN activity_id IS NULL OR activity_sc_id IS NULL
                      THEN id END) as orphaned_feedback,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN activity_id IS NOT NULL AND activity_sc_id IS NOT NULL
                                    THEN id END) / NULLIF(COUNT(DISTINCT id), 0), 2) as percent_mappable
FROM feedback_with_activities;

-- CHALLENGE 2: Multiple activities per feedback
-- If a lesson has multiple activities using the same SC, which one gets the feedback?

WITH feedback_activity_count AS (
  SELECT
    f.id,
    COUNT(DISTINCT a.activity_id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM activity_success_criteria asc
        WHERE asc.activity_id = a.activity_id
        AND asc.success_criteria_id = f.success_criteria_id
      )
    ) as matching_activity_count
  FROM feedback f
  LEFT JOIN activities a ON a.lesson_id = f.lesson_id
  GROUP BY f.id
)
SELECT
  matching_activity_count,
  COUNT(*) as feedback_entries,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percent
FROM feedback_activity_count
GROUP BY matching_activity_count
ORDER BY matching_activity_count;

-- CHALLENGE 3: Lesson Success Criteria without activities
-- These exist in curriculum mapper but have no activities

SELECT
  COUNT(*) as mapper_only_sc_links,
  COUNT(DISTINCT lsc.lesson_id) as affected_lessons,
  COUNT(DISTINCT lsc.success_criteria_id) as affected_scs
FROM lesson_success_criteria lsc
WHERE NOT EXISTS (
  SELECT 1
  FROM activities a
  JOIN activity_success_criteria asc ON asc.activity_id = a.activity_id
  WHERE a.lesson_id = lsc.lesson_id
  AND asc.success_criteria_id = lsc.success_criteria_id
);

-- MIGRATION STRATEGY DECISION TREE:
--
-- For each feedback(user_id, lesson_id, success_criteria_id, rating):
--
-- CASE 1: Exactly 1 activity in lesson uses that SC
--   → Migrate to activity_feedback(activity_id, pupil_id, sc_id, rating)
--   → Zero data loss ✅
--
-- CASE 2: Multiple activities in lesson use that SC
--   → Option A: Duplicate feedback to ALL matching activities
--   → Option B: Assign to first activity (by order_by)
--   → Option C: Create aggregate "lesson summary" activity
--   → Potential data interpretation change ⚠️
--
-- CASE 3: No activities in lesson use that SC (mapper-only)
--   → Option A: Delete feedback (data loss ❌)
--   → Option B: Create "unmapped" activity placeholder
--   → Option C: Keep old table for historical data
--   → Data loss or schema complexity ⚠️
--
-- CASE 4: Lesson has no activities at all
--   → Option A: Delete feedback (data loss ❌)
--   → Option B: Create placeholder activity
--   → Data loss or schema complexity ⚠️
