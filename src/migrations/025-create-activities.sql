drop table if exists activities;


create table activities (
    activity_id         text        primary key default gen_random_uuid(),
    lesson_id           text        references lessons(lesson_id),
    title               text        ,
    type                text        ,
    body_data           jsonb       ,
    is_homework         boolean     default false,
    order_by            INT         default null,
    active              boolean     default true
);