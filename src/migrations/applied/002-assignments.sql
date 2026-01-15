drop table if exists assignments;

create table assignments (
  group_id text not null,
  unit_id text not null,
  start_date date not null,
  end_date date not null,
  
  constraint assignments_pkey primary key (group_id, unit_id, start_date)
);

INSERT INTO assignments (group_id, unit_id, start_date, end_date) VALUES
('25-10-MA', 'UNIT001', '2023-10-01', '2023-10-31'),
('25-11-SC', 'UNIT002', '2023-10-01', '2023-10-31');

