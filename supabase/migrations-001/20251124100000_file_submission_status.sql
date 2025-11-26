-- Add submission_status to submissions to track upload lifecycle without relying on Supabase client APIs.

alter table public.submissions
  add column if not exists submission_status text;

update public.submissions
set submission_status = 'inprogress'
where submission_status is null;

alter table public.submissions
  alter column submission_status set default 'inprogress';

do
$$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_submission_status_check'
  ) then
    alter table public.submissions
      add constraint submissions_submission_status_check
      check (submission_status in ('inprogress', 'submitted', 'completed', 'rejected'));
  end if;
end;
$$;

alter table public.submissions
  alter column submission_status set not null;
