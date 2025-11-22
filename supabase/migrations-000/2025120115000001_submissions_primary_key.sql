alter table public.submissions
    drop constraint if exists submissions_replication_pk_pkey;

alter table public.submissions
    add column if not exists replication_pk uuid default gen_random_uuid();

alter table public.submissions
    add constraint submissions_replication_pk_pkey primary key (replication_pk);
