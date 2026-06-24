-- 20260625_teacher_subjects.sql
-- Many-to-many association between teachers (profiles) and subjects,
-- used to scope which units appear in the teacher planner's unit picker.

CREATE TABLE IF NOT EXISTS public.teacher_subjects (
  user_id text NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  subject text NOT NULL REFERENCES public.subjects(subject) ON DELETE CASCADE,
  PRIMARY KEY (user_id, subject)
);
