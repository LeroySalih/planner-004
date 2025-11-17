-- Ensure pgvector
create extension if not exists "vector" with schema "public";

-- Sequences
create sequence if not exists "public"."documents_id_seq";
create sequence if not exists "public"."n8n_chat_histories_id_seq";

-- Tables
create table if not exists "public"."documents" (
  "id" bigint not null default nextval('public.documents_id_seq'::regclass),
  "content" text,
  "metadata" jsonb,
  "embedding" public.vector(1536)
);

create table if not exists "public"."n8n_chat_histories" (
  "id" integer not null default nextval('public.n8n_chat_histories_id_seq'::regclass),
  "session_id" character varying(255) not null,
  "message" jsonb not null
);

-- Own sequences by columns (only if both sides exist)
do $$
begin
  if exists (select 1 from pg_class where relname = 'documents_id_seq' and relnamespace = 'public'::regnamespace)
     and exists (select 1 from pg_attribute where attrelid = 'public.documents'::regclass and attname = 'id') then
    alter sequence "public"."documents_id_seq" owned by "public"."documents"."id";
  end if;

  if exists (select 1 from pg_class where relname = 'n8n_chat_histories_id_seq' and relnamespace = 'public'::regnamespace)
     and exists (select 1 from pg_attribute where attrelid = 'public.n8n_chat_histories'::regclass and attname = 'id') then
    alter sequence "public"."n8n_chat_histories_id_seq" owned by "public"."n8n_chat_histories"."id";
  end if;
end$$;

-- Primary key indexes (created idempotently)
create unique index if not exists documents_pkey
  on public.documents using btree (id);

create unique index if not exists n8n_chat_histories_pkey
  on public.n8n_chat_histories using btree (id);

-- Attach PK constraints only if they don't already exist
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_pkey'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table "public"."documents"
      add constraint "documents_pkey" primary key using index "documents_pkey";
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'n8n_chat_histories_pkey'
      and conrelid = 'public.n8n_chat_histories'::regclass
  ) then
    alter table "public"."n8n_chat_histories"
      add constraint "n8n_chat_histories_pkey" primary key using index "n8n_chat_histories_pkey";
  end if;
end$$;

-- Submission composite index (idempotent)
create index if not exists idx_submissions_activity_submitted
  on public.submissions using btree (activity_id, submitted_at desc, submission_id);

set check_function_bodies = off;

-- Match function (safe to re-run)
create or replace function public.match_documents(
  query_embedding public.vector,
  match_count integer default null,
  filter jsonb default '{}'::jsonb
)
returns table(id bigint, content text, metadata jsonb, similarity double precision)
language plpgsql
as $function$
#variable_conflict use_column
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents as d
  where d.metadata @> filter
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$function$;

-- Grants (GRANT is additive; re-running is safe)
grant delete, insert, references, select, trigger, truncate, update on table "public"."documents" to "anon";
grant delete, insert, references, select, trigger, truncate, update on table "public"."documents" to "authenticated";
grant delete, insert, references, select, trigger, truncate, update on table "public"."documents" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."n8n_chat_histories" to "anon";
grant delete, insert, references, select, trigger, truncate, update on table "public"."n8n_chat_histories" to "authenticated";
grant delete, insert, references, select, trigger, truncate, update on table "public"."n8n_chat_histories" to "service_role";