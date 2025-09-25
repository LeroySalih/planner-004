drop table if exists group_membership;

create table group_membership (
    group_id text not null references groups(group_id) on delete cascade,
    user_id text not null,
    role text not null
);

INSERT INTO group_membership (group_id, user_id, role) VALUES 
('25-7A-DT', '3352f5a2-3c8b-420e-90b7-d95ab6f1756c', 'pupil'),
('25-7A-DT', 'e25087b7-f44d-4ea5-a469-5f9543d69bf1', 'pupil'),
('25-7A-DT', 'a59a492b-cb3d-499e-9152-1b0793ce7b44', 'pupil'),

('25-7A-DT', '1b83349c-3b8b-4ab0-aae9-470a4d085469', 'pupil'),
('25-7A-DT', 'da365bd8-7aa5-4ffb-acf0-2afaaf7152b6', 'pupil'),
('25-7A-DT', '47096e19-2f45-4b45-8e60-f9d71eef8168', 'pupil')
;