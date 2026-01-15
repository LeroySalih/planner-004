drop table if exists lesson_links;

create table lesson_links (
    lesson_link_id text primary key default gen_random_uuid(),
    lesson_id text references lessons(lesson_id) on delete cascade,
    url text not null,
    description text
    
);