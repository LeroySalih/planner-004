drop table if exists lessons;

create table lessons_learning_objective (
  learning_objective_id text not null references learning_objectives(learning_objective_id) on delete cascade,
  lesson_id text not null references lessons(lesson_id) on delete cascade,
  
  order_by integer not null default 0,
  
  title text not null,
  active boolean default true,

  primary key (learning_objective_id, lesson_id)
);