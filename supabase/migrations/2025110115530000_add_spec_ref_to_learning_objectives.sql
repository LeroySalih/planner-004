-- Adds spec_ref field to learning objectives for optional specification linking
alter table public.learning_objectives
    add column if not exists spec_ref text;
