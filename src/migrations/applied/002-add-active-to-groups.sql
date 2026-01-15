alter table groups
  add column if not exists active boolean not null default true;

update groups
set active = coalesce(active, true);
