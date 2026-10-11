-- 116-scores-use-latest-attempt.sql
--
-- A pupil's score on an activity is always their LATEST attempt: the highest
-- attempt_number. Earlier attempts stay in `submissions` for audit, but no
-- score, mark or average uses them.
--
-- These two functions already took one attempt per pupil and activity, but
-- picked it by newest submitted_at. Several write paths rewrite submitted_at
-- on an existing row, so an older attempt could overtake the latest one.
-- Each now orders by attempt_number first, like the rest of the app
-- (src/lib/scoring/latest-attempt.ts). Nothing else in either function changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.lesson_assignment_score_summaries(pairs jsonb)
 RETURNS TABLE(group_id text, lesson_id text, activities_average numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with dedup_pairs as (
    select distinct
      pair->>'groupId' as group_id,
      pair->>'lessonId' as lesson_id
    from jsonb_array_elements(coalesce(pairs, '[]'::jsonb)) as pair
    where coalesce(pair->>'groupId', '') <> ''
      and coalesce(pair->>'lessonId', '') <> ''
  ),
  pupils as (
    select distinct gm.group_id, gm.user_id
    from group_membership gm
    join dedup_pairs dp on dp.group_id = gm.group_id
    where gm.user_id is not null
  ),
  scorable_activities as (
    select distinct
      a.activity_id,
      a.lesson_id,
      lower(trim(coalesce(a.type, ''))) as activity_type,
      a.max_marks
    from activities a
    join dedup_pairs dp on dp.lesson_id = a.lesson_id
    where coalesce(a.active, true) = true
      and lower(trim(coalesce(a.type, ''))) = any (array[
        'multiple-choice-question', 'short-text-question', 'text-question',
        'long-text-question', 'upload-file', 'upload-url', 'upload-spreadsheet',
        'upload-worksheet', 'feedback', 'sketch-render', 'do-flashcards',
        'matcher', 'group-items', 'voice', 'sequence', 'mark-worksheet'
      ])
  ),
  pair_activity_pupil as (
    select
      dp.group_id,
      dp.lesson_id,
      act.activity_id,
      act.activity_type,
      act.max_marks,
      pup.user_id
    from dedup_pairs dp
    join scorable_activities act on act.lesson_id = dp.lesson_id
    join pupils pup on pup.group_id = dp.group_id
  ),
  submission_candidates as (
    select
      pap.group_id,
      pap.lesson_id,
      pap.activity_id,
      pap.activity_type,
      pap.max_marks,
      pap.user_id,
      s.submission_id,
      s.body,
      s.submitted_at,
      row_number() over (
        partition by pap.activity_id, pap.user_id
        order by s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
      ) as rn
    from pair_activity_pupil pap
    left join submissions s on s.activity_id = pap.activity_id and s.user_id = pap.user_id
  ),
  latest_submissions as (
    select *
    from submission_candidates
    where rn = 1
  ),
  submission_scores as (
    select
      ls.group_id,
      ls.lesson_id,
      coalesce(marks_score.score_value, 0)::numeric as score_value,
      case when ls.submission_id is not null then true else false end as has_submission
    from latest_submissions ls
    left join lateral (
      select
        case
          when ls.max_marks is null or ls.max_marks = 0 then null
          else compute_submission_marks(ls.body::jsonb, ls.activity_type, ls.max_marks)::numeric / ls.max_marks
        end as score_value
    ) as marks_score on true
  ),
  aggregated as (
    select
      ss.group_id,
      ss.lesson_id,
      sum(ss.score_value) as total_score,
      count(*) as cell_count,
      bool_or(ss.has_submission) as has_submission
    from submission_scores ss
    group by ss.group_id, ss.lesson_id
  )
  select
    dp.group_id,
    dp.lesson_id,
    case
      when agg.has_submission and agg.cell_count > 0 then clamp_score(agg.total_score / agg.cell_count)
      else null
    end as activities_average
  from dedup_pairs dp
  left join aggregated agg on agg.group_id = dp.group_id and agg.lesson_id = dp.lesson_id
  order by dp.group_id, dp.lesson_id;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.dashboard_class_progress_summary(p_teacher_id text)
 RETURNS TABLE(group_id text, group_subject text, total_pupils bigint, green_count bigint, amber_count bigint, red_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
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
      s.activity_id, s.user_id, s.body, a.type AS activity_type,
      a.max_marks, la.group_id
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
    ORDER BY s.activity_id, s.user_id, s.attempt_number DESC, s.submitted_at DESC NULLS LAST, s.submission_id DESC
  ),
  pupil_averages AS (
    SELECT
      ls.group_id,
      ls.user_id AS pupil_id,
      AVG(coalesce(
        compute_submission_base_score(ls.body::jsonb, ls.activity_type, ls.max_marks),
        0
      )) AS avg_score
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
$function$

;

COMMIT;
