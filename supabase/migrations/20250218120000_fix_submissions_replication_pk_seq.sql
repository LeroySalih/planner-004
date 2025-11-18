-- Align the submissions replication sequence with existing rows to avoid
-- duplicate primary keys when inserting new submissions.
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT COALESCE(MAX(replication_pk), 0) INTO v_max FROM public.submissions;
  PERFORM setval('public.submissions_replication_pk_seq', v_max, true);
END$$;
