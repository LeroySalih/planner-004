create table if not exists public.activity_submission_events (
    activity_submission_event_id text default gen_random_uuid() primary key,
    submission_id text,
    activity_id text not null,
    lesson_id text not null,
    pupil_id text not null,
    file_name text,
    submitted_at timestamptz not null default now()
);

create index if not exists idx_activity_submission_events_activity on public.activity_submission_events (activity_id);
create index if not exists idx_activity_submission_events_pupil on public.activity_submission_events (pupil_id);
create index if not exists idx_activity_submission_events_submitted_at on public.activity_submission_events (submitted_at desc);
