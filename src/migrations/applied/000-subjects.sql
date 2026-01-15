
drop table if exists subjects;

create table subjects (
  subject text primary key
);

INSERT INTO subjects (subject)
VALUES ('Mathematics'),
('Science'),
('History'),
('English'),
('Art'),
('Design Technology')
ON CONFLICT (subject) DO UPDATE
SET
  subject = EXCLUDED.subject
RETURNING *;