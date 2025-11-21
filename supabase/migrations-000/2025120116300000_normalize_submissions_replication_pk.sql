-- Normalize replication_pk so it works for Realtime and aligns with seeded integer values.

-- Drop identity/default to reset.
alter table public.submissions
    alter column replication_pk drop identity if exists,
    alter column replication_pk drop default;

-- Create/ensure sequence for bigint PK and set data type back to bigint to match seeds.
create sequence if not exists public.submissions_replication_pk_seq owned by public.submissions.replication_pk;

alter table public.submissions
    alter column replication_pk set data type bigint using replication_pk::bigint,
    alter column replication_pk set default nextval('public.submissions_replication_pk_seq'::regclass);

-- Ensure the primary key is intact.
alter table public.submissions
    drop constraint if exists submissions_replication_pk_pkey,
    add constraint submissions_replication_pk_pkey primary key (replication_pk);

-- Keep replica identity FULL for realtime payloads.
alter table public.submissions replica identity full;

-- Ensure table is in the realtime publication if not already.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table public.submissions;
  end if;
end $$;
