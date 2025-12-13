-- Add local auth support on profiles and introduce server-managed sessions

alter table public.profiles
  add column if not exists email text,
  add column if not exists password_hash text;

-- Default password hash for existing rows (bcrypt cost 10 for "bisak123")
update public.profiles
set password_hash = '$2b$10$8d6pphvMCMKlYXPklQs6iuZgq8MIHJYBPK3l9c5czgpLTsdBMxnmW'
where password_hash is null;

alter table public.profiles
  alter column password_hash set not null,
  alter column password_hash set default '$2b$10$8d6pphvMCMKlYXPklQs6iuZgq8MIHJYBPK3l9c5czgpLTsdBMxnmW';

-- Case-insensitive unique emails when provided
create unique index if not exists profiles_email_ci_idx
  on public.profiles ((lower(email)))
  where email is not null;

create table if not exists public.auth_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text null,
  user_agent text null
);

create index if not exists auth_sessions_user_id_idx on public.auth_sessions (user_id);
create index if not exists auth_sessions_expires_at_idx on public.auth_sessions (expires_at);
