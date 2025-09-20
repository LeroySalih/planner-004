drop table if exists lessons;

create table lessons (
  lesson_id text not null primary key default gen_random_uuid(),
  unit_id text not null references units(unit_id) on delete cascade,
  title text not null
);