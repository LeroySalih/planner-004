-- Apply RLS and access policies for pupil_activity_feedback
DO $$
BEGIN
  IF to_regclass('public.pupil_activity_feedback') IS NULL THEN
    RAISE NOTICE 'Skipping pupil_activity_feedback policy setup because the table does not exist.';
    RETURN;
  END IF;

  -- Ensure access goes through RLS
  ALTER TABLE public.pupil_activity_feedback ENABLE ROW LEVEL SECURITY;

  -- Authenticated users may read/write subject to policies; block anon by default
  GRANT SELECT, INSERT ON public.pupil_activity_feedback TO authenticated;
  REVOKE ALL ON public.pupil_activity_feedback FROM anon;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pupil_activity_feedback'
      AND policyname = 'select_pupil_activity_feedback_for_self_or_teacher'
  ) THEN
    CREATE POLICY select_pupil_activity_feedback_for_self_or_teacher
      ON public.pupil_activity_feedback
      FOR SELECT
      USING (
        auth.role() = 'service_role'
        OR pupil_id = auth.uid()::text
        OR EXISTS (
          SELECT 1
          FROM public.profiles pr
          WHERE pr.user_id = auth.uid()::text
            AND COALESCE(pr.is_teacher, false)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pupil_activity_feedback'
      AND policyname = 'insert_pupil_activity_feedback_for_self_or_teacher'
  ) THEN
    CREATE POLICY insert_pupil_activity_feedback_for_self_or_teacher
      ON public.pupil_activity_feedback
      FOR INSERT
      WITH CHECK (
        auth.role() = 'service_role'
        OR pupil_id = auth.uid()::text
        OR EXISTS (
          SELECT 1
          FROM public.profiles pr
          WHERE pr.user_id = auth.uid()::text
            AND COALESCE(pr.is_teacher, false)
        )
      );
  END IF;
END$$;
