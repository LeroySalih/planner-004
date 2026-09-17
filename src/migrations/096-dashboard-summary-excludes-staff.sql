-- 096-dashboard-summary-excludes-staff.sql
--
-- dashboard_class_progress_summary counted every group member except the
-- teacher running the query as a pupil. Any *other* member of staff in the
-- group -- four people hold a staff role -- was counted as a pupil, and their
-- own (usually empty) submissions landed in the red band.
--
-- This applies the same rule as src/lib/roles/pupil-membership.ts: holds
-- 'pupil', holds no staff role.
--
-- The scoring call deliberately stays on the two-argument
-- compute_submission_base_score. The three-argument form added in 095 reads
-- body->'marks_override', which is stored in absolute marks against an
-- activities.max_marks that is DERIVED from success criteria and changes
-- whenever criteria are added. 366 submissions carry a marks_override frozen
-- against a smaller, historical max_marks, so dividing by the current one
-- understates them badly (teacher average 85.8%, read back as 34.9%). Moving
-- the dashboard onto that form before the data is repaired would spread the
-- error rather than fix it.

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
    SELECT gm.group_id
    FROM group_membership gm
    JOIN groups g ON g.group_id = gm.group_id AND coalesce(g.active, true) = true
    WHERE gm.user_id = p_teacher_id
  ),
  pupil_members AS (
    SELECT gm.group_id, gm.user_id AS pupil_id
    FROM group_membership gm
    JOIN teacher_groups tg ON tg.group_id = gm.group_id
    WHERE gm.user_id != p_teacher_id
      AND exists (
        SELECT 1 FROM user_roles ur
         WHERE ur.user_id = gm.user_id AND lower(ur.role_id) = 'pupil'
      )
      AND NOT exists (
        SELECT 1 FROM user_roles ur
         WHERE ur.user_id = gm.user_id
           AND lower(ur.role_id) IN ('teacher', 'admin', 'technician')
      )
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
