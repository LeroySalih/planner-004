-- Backfill profile emails from auth.users for legacy Supabase accounts

alter table public.profiles
  add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where p.email is null
  and u.email is not null
  and u.id = p.user_id;

create unique index if not exists profiles_email_ci_idx
  on public.profiles ((lower(email)))
  where email is not null;
