-- SQL Query to list files in database with their lesson/activity context
-- Run with: docker exec postgres17 psql -U postgres -d postgres -f scripts/list-missing-files.sql

SELECT
  u.title as "Unit",
  l.title as "Lesson",
  a.title as "Activity",
  a.type as "Type",
  sf.file_name as "File Name",
  ROUND(sf.size_bytes / 1024.0, 2) || ' KB' as "Size",
  sf.stored_path as "File Path"
FROM stored_files sf
-- Extract lesson_id and activity_id from scope_path
LEFT JOIN LATERAL (
  SELECT
    CASE
      WHEN sf.scope_path ~ '^lessons/[^/]+/activities/[^/]+'
        THEN (regexp_matches(sf.scope_path, '^lessons/([^/]+)/activities/([^/]+)'))[1]
      WHEN sf.scope_path ~ '^[^/]+/activities/[^/]+$'
        THEN (regexp_matches(sf.scope_path, '^([^/]+)/activities/([^/]+)$'))[1]
      ELSE NULL
    END as lesson_id,
    CASE
      WHEN sf.scope_path ~ '^lessons/[^/]+/activities/([^/]+)'
        THEN (regexp_matches(sf.scope_path, '^lessons/[^/]+/activities/([^/]+)'))[1]
      WHEN sf.scope_path ~ '^[^/]+/activities/[^/]+$'
        THEN (regexp_matches(sf.scope_path, '^[^/]+/activities/([^/]+)$'))[2]
      ELSE NULL
    END as activity_id
) parsed ON true
LEFT JOIN lessons l ON l.lesson_id = parsed.lesson_id
LEFT JOIN activities a ON a.activity_id = parsed.activity_id
LEFT JOIN units u ON u.unit_id = l.unit_id
WHERE sf.bucket = 'lessons'
  AND parsed.lesson_id IS NOT NULL
ORDER BY u.title NULLS LAST, l.title NULLS LAST, a.order_by NULLS LAST, sf.file_name;

-- Summary count
SELECT
  COUNT(*) as "Total Files in Database"
FROM stored_files
WHERE bucket = 'lessons';
