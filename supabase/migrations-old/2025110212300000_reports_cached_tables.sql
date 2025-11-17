-- Report cache tables to support precomputed report datasets and feedback aggregations
create table if not exists public.report_pupil_cache (
  pupil_id text primary key references public.profiles (user_id) on delete cascade,
  dataset jsonb not null,
  calculated_at timestamptz not null default now()
);

comment on table public.report_pupil_cache is 'Precomputed per-pupil report dataset payloads powering /reports views.';
comment on column public.report_pupil_cache.dataset is 'Full dataset as returned by reports_get_prepared_report_dataset.';

create table if not exists public.report_pupil_feedback_cache (
  pupil_id text not null references public.profiles (user_id) on delete cascade,
  success_criteria_id text not null,
  latest_feedback_id bigint not null,
  latest_rating integer,
  updated_at timestamptz not null default now(),
  primary key (pupil_id, success_criteria_id)
);

comment on table public.report_pupil_feedback_cache is 'Latest feedback/rating snapshot per pupil and success criterion for group-level aggregations.';

create index if not exists idx_report_pupil_feedback_cache_criteria
  on public.report_pupil_feedback_cache (success_criteria_id, pupil_id);

-- Transactional procedure to (re)calculate cache rows for a pupil
create or replace function public.reports_recalculate_pupil_cache(
  p_pupil_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  dataset jsonb;
begin
  if coalesce(trim(p_pupil_id), '') = '' then
    raise exception 'pupil id is required';
  end if;

  select public.reports_get_prepared_report_dataset(p_pupil_id, null)
    into dataset;

  if dataset is null then
    dataset := '{}'::jsonb;
  end if;

  insert into public.report_pupil_cache (pupil_id, dataset, calculated_at)
  values (p_pupil_id, dataset, now())
  on conflict (pupil_id) do update
    set dataset = excluded.dataset,
        calculated_at = excluded.calculated_at;

  delete from public.report_pupil_feedback_cache where pupil_id = p_pupil_id;

  insert into public.report_pupil_feedback_cache (pupil_id, success_criteria_id, latest_feedback_id, latest_rating, updated_at)
  select
    p_pupil_id as pupil_id,
    latest.success_criteria_id,
    latest.id,
    latest.rating,
    now()
  from (
    select distinct on (success_criteria_id)
      success_criteria_id,
      id,
      rating
    from public.feedback
    where user_id = p_pupil_id
    order by success_criteria_id, id desc
  ) as latest
  where coalesce(trim(latest.success_criteria_id), '') <> '';

  return dataset;
end;
$function$;

grant execute on function public.reports_recalculate_pupil_cache(text) to authenticated, service_role;

-- Backfill cached rows for pupils with existing feedback
do $$
declare
  rec record;
begin
  for rec in (
    select distinct user_id
    from public.feedback
    where coalesce(trim(user_id), '') <> ''
  ) loop
    perform public.reports_recalculate_pupil_cache(rec.user_id);
  end loop;
end $$;
