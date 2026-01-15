drop table if exists learning_objectives;

create table learning_objectives (
  learning_objective_id text not null primary key default gen_random_uuid(),
  unit_id text not null references units(unit_id) on delete cascade,
  title text not null
);