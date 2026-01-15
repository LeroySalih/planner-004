
drop table if exists groups;

create table groups (
  group_id text not null,
  created_at timestamp with time zone not null default now(),
  join_code text null,
  subject text null,
  constraint groups_pkey primary key (group_id)
);

INSERT INTO groups (group_id, join_code, subject) VALUES
('25-10-MA', 'JOIN123', 'Mathematics'),
('25-11-SC', 'JOIN456', 'Science'),
('25-10-HI', 'JOIN789', 'History');