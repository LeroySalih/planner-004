drop index if exists "public"."idx_submissions_activity_submitted";

-- Ensure replication_pk exists without assuming prior migrations.
alter table "public"."submissions"
    add column if not exists "replication_pk" uuid default gen_random_uuid();

-- Recreate the index safely.
CREATE INDEX idx_submissions_activity_submitted ON public.submissions USING btree (activity_id, submitted_at DESC, submission_id);

