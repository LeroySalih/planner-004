CREATE TABLE IF NOT EXISTS public.marking_guidances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL REFERENCES public.subjects(subject) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marking_guidances_subject_idx ON public.marking_guidances (subject);
