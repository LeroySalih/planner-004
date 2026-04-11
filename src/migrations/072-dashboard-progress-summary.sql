-- 072-dashboard-progress-summary.sql
-- Returns per-class pupil counts in three score bands (green ≥70%, amber 40-69%, red <40%)
-- for all classes where the given teacher is a member.
-- Note: in this schema group_membership contains pupils only; teachers access all active groups.

CREATE OR REPLACE FUNCTION dashboard_class_progress_summary(p_teacher_id text)
RETURNS TABLE (
  group_id text,
  group_subject text,
  total_pupils bigint,
  green_count bigint,
  amber_count bigint,
  red_count bigint
) AS $$
  WITH teacher_groups AS (
    SELECT g.group_id
    FROM groups g
    WHERE coalesce(g.active, true) = true
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = p_teacher_id AND ur.role_id = 'teacher'
      )
  ),
  pupil_members AS (
    SELECT gm.group_id, gm.user_id AS pupil_id
    FROM group_membership gm
    JOIN teacher_groups tg ON tg.group_id = gm.group_id
  ),
  latest_submissions AS (
    SELECT DISTINCT ON (s.activity_id, s.user_id)
      s.activity_id, s.user_id, s.body, a.type AS activity_type, la.group_id
    FROM submissions s
    JOIN activities a ON a.activity_id = s.activity_id
      AND lower(trim(coalesce(a.type, ''))) = ANY(ARRAY[
        'multiple-choice-question','short-text-question','upload-file'
      ])
      AND coalesce(a.active, true) = true
    JOIN lessons l ON l.lesson_id = a.lesson_id
      AND coalesce(l.active, true) = true
    JOIN lesson_assignments la ON la.lesson_id = l.lesson_id
    JOIN teacher_groups tg ON tg.group_id = la.group_id
    JOIN pupil_members pm ON pm.group_id = la.group_id AND pm.pupil_id = s.user_id
    WHERE s.submitted_at IS NOT NULL
    ORDER BY s.activity_id, s.user_id, s.submitted_at DESC NULLS LAST, s.submission_id DESC
  ),
  pupil_averages AS (
    SELECT
      ls.group_id,
      ls.user_id AS pupil_id,
      AVG(coalesce(compute_submission_base_score(ls.body::jsonb, ls.activity_type), 0)) AS avg_score
    FROM latest_submissions ls
    GROUP BY ls.group_id, ls.user_id
  ),
  all_pupils AS (
    SELECT
      pm.group_id,
      pm.pupil_id,
      coalesce(pa.avg_score, 0) AS avg_score
    FROM pupil_members pm
    LEFT JOIN pupil_averages pa ON pa.group_id = pm.group_id AND pa.pupil_id = pm.pupil_id
  )
  SELECT
    g.group_id,
    g.subject AS group_subject,
    count(*) AS total_pupils,
    count(*) FILTER (WHERE ap.avg_score >= 0.70) AS green_count,
    count(*) FILTER (WHERE ap.avg_score >= 0.40 AND ap.avg_score < 0.70) AS amber_count,
    count(*) FILTER (WHERE ap.avg_score < 0.40) AS red_count
  FROM all_pupils ap
  JOIN groups g ON g.group_id = ap.group_id
  GROUP BY g.group_id, g.subject
  ORDER BY g.group_id;
$$ LANGUAGE sql STABLE;
