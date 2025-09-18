drop table if exists units;

create table units (
  unit_id text not null primary key default gen_random_uuid(),
  title text    ,
  subject text not null references subjects(subject)
);

INSERT INTO units (unit_id, title, subject) VALUES
('UNIT001', 'Algebra Basics', 'Mathematics'),
('UNIT002', 'Introduction to Biology', 'Science'),
('UNIT003', 'World War II Overview', 'History');