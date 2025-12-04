create table if not exists public.stored_files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  scope_path text not null,
  file_name text not null,
  stored_path text not null,
  content_type text,
  size_bytes bigint,
  checksum text,
  uploaded_by text,
  original_path text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists stored_files_bucket_scope_name_idx
  on public.stored_files (bucket, scope_path, file_name);

create index if not exists stored_files_bucket_scope_idx
  on public.stored_files (bucket, scope_path);
