create table if not exists public.sse_events (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  emitted_by text references public.profiles(user_id),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists sse_events_topic_created_idx on public.sse_events (topic, created_at desc);
create index if not exists sse_events_created_idx on public.sse_events (created_at desc);

-- Align emitted_by type with profiles.user_id if the table already exists (was uuid).
alter table public.sse_events
  alter column emitted_by type text using emitted_by::text;
alter table public.sse_events
  drop constraint if exists sse_events_emitted_by_fkey;
alter table public.sse_events
  add constraint sse_events_emitted_by_fkey foreign key (emitted_by) references public.profiles(user_id);
