BEGIN;
ALTER TABLE public.revision_answers DROP CONSTRAINT IF EXISTS revision_answers_status_check;
ALTER TABLE public.revision_answers ADD CONSTRAINT revision_answers_status_check
  CHECK (status = ANY (ARRAY['pending_marking'::text, 'marking'::text, 'marked'::text, 'pending_manual'::text]));
COMMIT;
