-- 071-lesson-is-public.sql
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false NOT NULL;
