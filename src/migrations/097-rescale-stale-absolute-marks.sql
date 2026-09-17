-- 097-rescale-stale-absolute-marks.sql
--
-- submissions.body stores marks in two incompatible ways: scale-free fractions
-- (teacher_override_score, ai_model_score, score, auto_score) and absolute
-- marks (marks_override, ai_marks, marks) that only mean anything against
-- activities.max_marks.
--
-- max_marks is DERIVED from the success criteria, so it changes whenever a
-- criterion is added, retyped or relinked -- and nothing ever rescaled the
-- absolute fields to match. Every one of those edits silently rewrote the
-- scores of work that had already been marked.
--
-- Measured before this ran:
--
--   marks_override   366 of 1 278 rows stale
--   marks            515 of 7 486 rows stale
--   ai_marks          84 of 1 257 rows stale
--
-- Every stale marks_override implied a SMALLER historical max_marks (2 from 1,
-- 4 from 1, 14 from 4, 6 from 3 ...) -- always a clean integer, which is how we
-- know these are drift rather than marks a teacher actually typed. Across those
-- rows the teacher's own figure averaged 85.8% and the app read it back as
-- 34.9%. One real case: teacher_override_score 1.0 with marks_override 1
-- against a max_marks of 4, displayed to the pupil as 25%.
--
-- The repair recomputes each absolute field from the fraction beside it, which
-- never drifted. CEIL and the clamp to [0, max_marks] match migration 077, so
-- a row repaired here and a row written by the app agree.
--
-- Order does not matter: compute_submission_base_score's two-argument form
-- reads no absolute field, so repairing marks_override cannot move the target
-- that marks is repaired against.
--
-- src/lib/scoring/derive-max-marks.ts now rescales these fields whenever it
-- changes max_marks, so this is a one-off and not a recurring sweep.

BEGIN;

-- 1. marks_override, from the teacher's own fraction.
UPDATE submissions s
SET body = jsonb_set(
      s.body::jsonb,
      '{marks_override}',
      to_jsonb(least(
        a.max_marks,
        greatest(0, ceil((s.body::jsonb->>'teacher_override_score')::numeric * a.max_marks))
      )::int),
      true
    )::json
FROM activities a
WHERE a.activity_id = s.activity_id
  AND coalesce(a.max_marks, 0) > 0
  AND s.body::jsonb ? 'marks_override'
  AND s.body::jsonb->>'marks_override' IS NOT NULL
  AND nullif(s.body::jsonb->>'teacher_override_score', '') IS NOT NULL
  AND (s.body::jsonb->>'marks_override')::numeric
      IS DISTINCT FROM ceil((s.body::jsonb->>'teacher_override_score')::numeric * a.max_marks);

-- 2. ai_marks, from the cached AI fraction.
UPDATE submissions s
SET body = jsonb_set(
      s.body::jsonb,
      '{ai_marks}',
      to_jsonb(least(
        a.max_marks,
        greatest(0, ceil((s.body::jsonb->>'ai_model_score')::numeric * a.max_marks))
      )::int),
      true
    )::json
FROM activities a
WHERE a.activity_id = s.activity_id
  AND coalesce(a.max_marks, 0) > 0
  AND s.body::jsonb ? 'ai_marks'
  AND s.body::jsonb->>'ai_marks' IS NOT NULL
  AND nullif(s.body::jsonb->>'ai_model_score', '') IS NOT NULL
  AND (s.body::jsonb->>'ai_marks')::numeric
      IS DISTINCT FROM ceil((s.body::jsonb->>'ai_model_score')::numeric * a.max_marks);

-- 3. marks, from the base score -- the same source migration 077 derived it
-- from. The two-argument form is deliberate: it reads only fractions.
UPDATE submissions s
SET body = jsonb_set(
      s.body::jsonb,
      '{marks}',
      to_jsonb(least(
        a.max_marks,
        greatest(0, ceil(compute_submission_base_score(s.body, a.type) * a.max_marks))
      )::int),
      true
    )::json
FROM activities a
WHERE a.activity_id = s.activity_id
  AND coalesce(a.max_marks, 0) > 0
  AND s.body::jsonb ? 'marks'
  AND s.body::jsonb->>'marks' IS NOT NULL
  AND compute_submission_base_score(s.body, a.type) IS NOT NULL
  AND (s.body::jsonb->>'marks')::numeric
      IS DISTINCT FROM ceil(compute_submission_base_score(s.body, a.type) * a.max_marks);

COMMIT;
