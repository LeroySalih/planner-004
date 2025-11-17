-- Create per-unit summary cache for reports
create table if not exists public.report_pupil_unit_summaries (
  pupil_id text not null references public.profiles (user_id) on delete cascade,
  unit_id text not null,
  unit_title text,
  unit_subject text,
  unit_description text,
  unit_year integer,
  related_group_ids text[] not null default '{}',
  grouped_levels jsonb not null default '[]'::jsonb,
  working_level integer,
  activities_average double precision,
  assessment_average double precision,
  assessment_level text,
  score_error text,
  objective_error text,
  updated_at timestamptz not null default now(),
  primary key (pupil_id, unit_id)
);

create index if not exists idx_report_pupil_unit_summaries_subject
  on public.report_pupil_unit_summaries (unit_subject);

create index if not exists idx_report_pupil_unit_summaries_pupil_subject
  on public.report_pupil_unit_summaries (pupil_id, unit_subject);

create index if not exists idx_report_pupil_unit_summaries_group_ids
  on public.report_pupil_unit_summaries using gin (related_group_ids);

create or replace function public.reports_store_pupil_unit_summaries(
  p_pupil_id text,
  p_units jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(trim(p_pupil_id), '') = '' then
    raise exception 'pupil id is required';
  end if;

  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'units payload must be a json array';
  end if;

  delete from public.report_pupil_unit_summaries where pupil_id = p_pupil_id;

  insert into public.report_pupil_unit_summaries (
    pupil_id,
    unit_id,
    unit_title,
    unit_subject,
    unit_description,
    unit_year,
    related_group_ids,
    grouped_levels,
    working_level,
    activities_average,
    assessment_average,
    assessment_level,
    score_error,
    objective_error,
    updated_at
  )
  select
    p_pupil_id,
    unit->>'unitId',
    nullif(unit->>'unitTitle', ''),
    nullif(unit->>'unitSubject', ''),
    nullif(unit->>'unitDescription', ''),
    case when (unit->>'unitYear') ~ '^-?\\d+$' then (unit->>'unitYear')::integer else null end,
    coalesce(
      array(
        select elem::text
        from jsonb_array_elements_text(coalesce(unit->'relatedGroups', '[]'::jsonb)) as elem
      ),
      '{}'
    ),
    coalesce(unit->'groupedLevels', '[]'::jsonb),
    case when (unit->>'workingLevel') ~ '^-?\\d+$' then (unit->>'workingLevel')::integer else null end,
    nullif(unit->>'activitiesAverage', '')::double precision,
    nullif(unit->>'assessmentAverage', '')::double precision,
    nullif(unit->>'assessmentLevel', ''),
    nullif(unit->>'scoreError', ''),
    nullif(unit->>'objectiveError', ''),
    now()
  from jsonb_array_elements(p_units) as unit;
end;
$function$;

grant execute on function public.reports_store_pupil_unit_summaries(text, jsonb) to service_role;
