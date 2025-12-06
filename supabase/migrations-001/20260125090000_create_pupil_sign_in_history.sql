-- Record each authenticated pupil page render for debugging and telemetry.

create table if not exists public.pupil_sign_in_history (
    pupil_sign_in_history_id text default gen_random_uuid() not null,
    pupil_id text not null,
    url text not null,
    signed_in_at timestamptz default now() not null
);

alter table public.pupil_sign_in_history owner to postgres;

alter table public.pupil_sign_in_history
  add constraint pupil_sign_in_history_pupil_id_fkey
  foreign key (pupil_id) references public.profiles (user_id);
