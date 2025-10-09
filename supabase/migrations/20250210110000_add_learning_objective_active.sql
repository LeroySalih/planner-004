alter table public.learning_objectives
  add column if not exists active boolean default true;

update public.learning_objectives
  set active = coalesce(active, true);

alter table public.learning_objectives
  alter column active set default true;

alter table public.learning_objectives
  alter column active set not null;
