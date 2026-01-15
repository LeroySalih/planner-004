drop table if exists feedback;

create table feedback (
    id serial primary key,
    user_id text not null,
    lesson_id text not null,
    success_criteria_id text not null,
    rating integer not null
);

create unique index feedback_unique_user_lesson_criterion on feedback (user_id, lesson_id, success_criteria_id);
