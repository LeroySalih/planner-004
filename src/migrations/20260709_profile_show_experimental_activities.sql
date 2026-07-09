-- Add a per-teacher toggle controlling whether experimental activity types are
-- shown in the lesson-design activity picker. Off by default.
alter table profiles
  add column if not exists show_experimental_activities boolean not null default false;
