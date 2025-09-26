drop table if exists profiles;

create table profiles (
    user_id text primary key ,
    first_name text,
    last_name text
);

INSERT INTO profiles (user_id, first_name, last_name) 
VALUES ('3352f5a2-3c8b-420e-90b7-d95ab6f1756c', 'Pupil 1', 'Test'),
('e25087b7-f44d-4ea5-a469-5f9543d69bf1', 'Pupil 2', 'Test'),
('a59a492b-cb3d-499e-9152-1b0793ce7b44', 'Pupil 3', 'Test'),

('1b83349c-3b8b-4ab0-aae9-470a4d085469', 'Pupil 4', 'Test'),
('da365bd8-7aa5-4ffb-acf0-2afaaf7152b6', 'Pupil 5', 'Test'),
('47096e19-2f45-4b45-8e60-f9d71eef8168', 'Pupil 6', 'Test')
;

