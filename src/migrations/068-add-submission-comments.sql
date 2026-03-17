-- Migration 068: Add submission_comments table for pupil-to-teacher mentions
CREATE TABLE IF NOT EXISTS public.submission_comments (
  id            text        NOT NULL DEFAULT gen_random_uuid(),
  submission_id text        NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  user_id       text        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  comment       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_comments_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_sc_submission ON public.submission_comments (submission_id);
CREATE INDEX IF NOT EXISTS idx_sc_user       ON public.submission_comments (user_id);
