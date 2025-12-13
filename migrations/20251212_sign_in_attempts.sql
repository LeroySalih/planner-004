-- Track sign-in attempts (success and failure) for throttling and auditing.
create table if not exists public.sign_in_attempts (
  sign_in_attempt_id uuid default gen_random_uuid() primary key,
  email text not null,
  ip text,
  user_id text,
  success boolean not null,
  reason text,
  attempted_at timestamptz not null default now()
);

create index if not exists sign_in_attempts_email_attempted_at_idx
  on public.sign_in_attempts (email, attempted_at desc);

create index if not exists sign_in_attempts_ip_attempted_at_idx
  on public.sign_in_attempts (ip, attempted_at desc);

create index if not exists sign_in_attempts_attempted_at_idx
  on public.sign_in_attempts (attempted_at desc);

alter table if exists public.sign_in_attempts
  add constraint sign_in_attempts_user_id_fkey
  foreign key (user_id) references public.profiles (user_id)
  on delete set null;
