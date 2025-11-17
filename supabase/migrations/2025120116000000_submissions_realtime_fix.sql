-- Ensure submissions emits full rows for Realtime and is part of the publication.

-- Primary key and replica identity
alter table public.submissions
    add column if not exists replication_pk uuid default gen_random_uuid();

alter table public.submissions
    drop constraint if exists submissions_replication_pk_pkey,
    add constraint submissions_replication_pk_pkey primary key (replication_pk);

alter table public.submissions replica identity full;

-- Make sure submissions is published to Supabase Realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.submissions;
  exception
    when duplicate_table then
      null; -- already added, skip
  end;
end $$;
