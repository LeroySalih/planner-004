drop table if exists success_criteria;

create table success_criteria (
  success_criteria_id text not null primary key default gen_random_uuid(),
  learning_objective_id text not null references learning_objectives(learning_objective_id) on delete cascade,
  
  title text not null
);