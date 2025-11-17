-- Short text feedback event audit log plus helper function for MCP auto-population.

create table if not exists public.short_text_feedback_events (
  feedback_event_id text primary key default gen_random_uuid(),
  assignment_id text,
  lesson_id text,
  activity_id text not null references public.activities(activity_id) on delete cascade,
  submission_id text references public.submissions(submission_id) on delete set null,
  pupil_id text not null references public.profiles(user_id) on delete cascade,
  activity_question text,
  activity_model_answer text,
  pupil_answer text,
  ai_score numeric,
  ai_feedback text,
  request_context jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists short_text_feedback_events_activity_pupil_idx
  on public.short_text_feedback_events (activity_id, pupil_id);

create index if not exists short_text_feedback_events_assignment_pupil_idx
  on public.short_text_feedback_events (assignment_id, pupil_id);

-- Function to fetch the latest short-text submission plus its activity metadata.
create or replace function public.get_latest_short_text_submission(
  p_activity_id text,
  p_pupil_id text
)
returns table (
  submission_id text,
  activity_id text,
  lesson_id text,
  activity_question text,
  activity_model_answer text,
  pupil_answer text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_submission record;
  activity_row record;
begin
  select s.submission_id,
         s.activity_id,
         s.user_id,
         s.submitted_at,
         s.body
    into latest_submission
    from public.submissions s
   where s.activity_id = p_activity_id
     and s.user_id = p_pupil_id
   order by coalesce(s.submitted_at, timezone('utc', now())) desc
   limit 1;

  select a.activity_id,
         a.lesson_id,
         a.type,
         a.body_data
    into activity_row
    from public.activities a
   where a.activity_id = p_activity_id;

  if activity_row.activity_id is null then
    return;
  end if;

  if coalesce(activity_row.type, '') <> 'short-text-question' then
    return;
  end if;

  return query
  select
    latest_submission.submission_id,
    activity_row.activity_id,
    activity_row.lesson_id,
    activity_row.body_data ->> 'question' as activity_question,
    activity_row.body_data ->> 'modelAnswer' as activity_model_answer,
    (latest_submission.body::jsonb ->> 'answer') as pupil_answer,
    latest_submission.submitted_at;
end;
$$;

grant execute on function public.get_latest_short_text_submission(text, text) to service_role;
grant execute on function public.get_latest_short_text_submission(text, text) to authenticated;
