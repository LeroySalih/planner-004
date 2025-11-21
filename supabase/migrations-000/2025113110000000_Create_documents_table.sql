-- Enable pgvector
create extension if not exists "vector" with schema public;

-- === Drop existing documents table (if exists) ===
drop table if exists public.documents cascade;

-- === Embedding table (768 dims) ===
create table public.documents (
  id        bigserial primary key,
  content   text,
  metadata  jsonb,
  embedding public.vector(768)
);

-- Optional: half precision (pgvector >= 0.6)
-- alter table public.documents
--   alter column embedding type public.halfvec(768) using (embedding::public.halfvec(768));

-- === Similarity search RPC for n8n ===
create or replace function public.match_documents(
  query_embedding public.vector,          -- vector input
  match_count integer default 10,
  filter jsonb default '{}'::jsonb
)
returns table(
  id bigint,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql stable
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.metadata @> filter
  order by d.embedding <=> query_embedding
  limit match_count
$$;

-- === HNSW index (cosine) ===
create index if not exists documents_embedding_hnsw
  on public.documents using hnsw (embedding vector_cosine_ops);

-- === Permissions (optional, for n8n service role) ===
grant select, insert, update, delete on public.documents to service_role;