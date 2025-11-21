-- Create a unified feedback table for all activity/pupil/source combinations
DO $$
BEGIN
  IF to_regclass('public.activities') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE NOTICE 'Skipping pupil_activity_feedback creation because required tables are missing.';
  ELSE
    EXECUTE $create$
      create table if not exists public.pupil_activity_feedback (
        feedback_id uuid primary key default gen_random_uuid(),
        activity_id text not null references public.activities(activity_id) on delete cascade,
        pupil_id text not null references public.profiles(user_id) on delete cascade,
        submission_id text references public.submissions(submission_id) on delete set null,
        source text not null check (source in ('teacher', 'auto', 'ai')),
        score numeric,
        feedback_text text,
        created_at timestamptz not null default now(),
        created_by text references public.profiles(user_id),
        constraint pupil_activity_feedback_score_range check (
          score is null or (score >= 0 and score <= 1)
        )
      )
    $create$;

    IF to_regclass('public.pupil_activity_feedback') IS NOT NULL THEN
      EXECUTE
        'create index if not exists idx_pupil_activity_feedback_activity_pupil_created_at
          on public.pupil_activity_feedback (activity_id, pupil_id, created_at desc)';

      EXECUTE
        'create index if not exists idx_pupil_activity_feedback_submission
          on public.pupil_activity_feedback (submission_id)';
    END IF;
  END IF;
END$$;

-- Backfill teacher overrides + comments from existing submissions
DO $$
BEGIN
  IF to_regclass('public.submissions') IS NULL THEN
    RAISE NOTICE 'Skipping teacher feedback backfill because public.submissions is missing.';
  ELSE
    INSERT INTO public.pupil_activity_feedback (
      feedback_id,
      activity_id,
      pupil_id,
      submission_id,
      source,
      score,
      feedback_text,
      created_at
    )
    SELECT
      gen_random_uuid(),
      s.activity_id,
      s.user_id,
      s.submission_id,
      'teacher',
      NULLIF((s.body::jsonb)->>'teacher_override_score', '')::numeric,
      NULLIF(btrim((s.body::jsonb)->>'teacher_feedback'), ''),
      COALESCE(s.submitted_at, now())
    FROM public.submissions s
    WHERE COALESCE((s.body::jsonb)->>'teacher_feedback', '') <> ''
       OR COALESCE((s.body::jsonb)->>'teacher_override_score', '') <> '';
  END IF;
END$$;

-- Backfill AI generated marks from submissions
DO $$
BEGIN
  IF to_regclass('public.submissions') IS NULL THEN
    RAISE NOTICE 'Skipping AI feedback backfill because public.submissions is missing.';
  ELSE
    INSERT INTO public.pupil_activity_feedback (
      feedback_id,
      activity_id,
      pupil_id,
      submission_id,
      source,
      score,
      feedback_text,
      created_at
    )
    SELECT
      gen_random_uuid(),
      s.activity_id,
      s.user_id,
      s.submission_id,
      'ai',
      NULLIF((s.body::jsonb)->>'ai_model_score', '')::numeric,
      NULLIF(btrim((s.body::jsonb)->>'ai_model_feedback'), ''),
      COALESCE(s.submitted_at, now())
    FROM public.submissions s
    WHERE COALESCE((s.body::jsonb)->>'ai_model_feedback', '') <> ''
       OR COALESCE((s.body::jsonb)->>'ai_model_score', '') <> '';
  END IF;
END$$;
