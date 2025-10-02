create sequence "public"."feedback_id_seq";

create table "public"."activities" (
    "activity_id" text not null default gen_random_uuid(),
    "lesson_id" text,
    "title" text,
    "type" text,
    "body_data" jsonb,
    "is_homework" boolean default false,
    "order_by" integer,
    "active" boolean default true
);


create table "public"."assessment_objectives" (
    "assessment_objective_id" text not null default gen_random_uuid(),
    "curriculum_id" text,
    "unit_id" text,
    "code" text not null,
    "title" text not null,
    "order_index" integer not null default 0
);


create table "public"."assignments" (
    "group_id" text not null,
    "unit_id" text not null,
    "start_date" date not null,
    "end_date" date not null,
    "active" boolean default true
);


create table "public"."curricula" (
    "curriculum_id" text not null default gen_random_uuid(),
    "subject" text,
    "title" text not null,
    "description" text,
    "active" boolean default true
);


create table "public"."feedback" (
    "id" integer not null default nextval('feedback_id_seq'::regclass),
    "user_id" text not null,
    "lesson_id" text not null,
    "success_criteria_id" text not null,
    "rating" integer not null
);


create table "public"."group_membership" (
    "group_id" text not null,
    "user_id" text not null,
    "role" text not null
);


create table "public"."groups" (
    "group_id" text not null,
    "created_at" timestamp with time zone not null default now(),
    "join_code" text,
    "subject" text,
    "active" boolean default true
);


create table "public"."learning_objectives" (
    "learning_objective_id" text not null default gen_random_uuid(),
    "assessment_objective_id" text not null,
    "title" text not null,
    "order_index" integer not null default 0
);


create table "public"."lesson_assignments" (
    "group_id" text not null,
    "lesson_id" text not null,
    "start_date" date not null
);


create table "public"."lesson_links" (
    "lesson_link_id" text not null default gen_random_uuid(),
    "lesson_id" text,
    "url" text not null,
    "description" text
);


create table "public"."lessons" (
    "lesson_id" text not null default gen_random_uuid(),
    "unit_id" text not null,
    "title" text not null,
    "active" boolean default true,
    "order_by" integer not null
);


create table "public"."lessons_learning_objective" (
    "learning_objective_id" text not null,
    "lesson_id" text not null,
    "order_index" integer not null default 0,
    "title" text not null,
    "active" boolean default true,
    "order_by" integer not null
);


create table "public"."profiles" (
    "user_id" text not null,
    "first_name" text,
    "last_name" text,
    "is_teacher" boolean default false
);


create table "public"."subjects" (
    "subject" text not null,
    "active" boolean default true
);


create table "public"."success_criteria" (
    "success_criteria_id" text not null default gen_random_uuid(),
    "learning_objective_id" text not null,
    "level" integer not null default 1,
    "description" text not null,
    "order_index" integer not null default 0,
    "active" boolean default true
);


create table "public"."success_criteria_units" (
    "success_criteria_id" text not null,
    "unit_id" text not null
);


create table "public"."units" (
    "unit_id" text not null default gen_random_uuid(),
    "title" text,
    "subject" text not null,
    "active" boolean default true,
    "description" character varying,
    "year" integer
);


alter sequence "public"."feedback_id_seq" owned by "public"."feedback"."id";

CREATE UNIQUE INDEX activities_pkey ON public.activities USING btree (activity_id);

CREATE UNIQUE INDEX assessment_objectives_curriculum_id_code_key ON public.assessment_objectives USING btree (curriculum_id, code);

CREATE INDEX assessment_objectives_curriculum_id_idx ON public.assessment_objectives USING btree (curriculum_id);

CREATE UNIQUE INDEX assessment_objectives_pkey ON public.assessment_objectives USING btree (assessment_objective_id);

CREATE UNIQUE INDEX assessment_objectives_unit_id_key ON public.assessment_objectives USING btree (unit_id);

CREATE UNIQUE INDEX assignments_pkey ON public.assignments USING btree (group_id, unit_id, start_date);

CREATE UNIQUE INDEX curricula_pkey ON public.curricula USING btree (curriculum_id);

CREATE UNIQUE INDEX feedback_pkey ON public.feedback USING btree (id);

CREATE UNIQUE INDEX feedback_unique_user_lesson_criterion ON public.feedback USING btree (user_id, lesson_id, success_criteria_id);

CREATE UNIQUE INDEX groups_pkey ON public.groups USING btree (group_id);

CREATE INDEX learning_objectives_assessment_objective_id_idx ON public.learning_objectives USING btree (assessment_objective_id, order_index);

CREATE UNIQUE INDEX learning_objectives_pkey ON public.learning_objectives USING btree (learning_objective_id);

CREATE UNIQUE INDEX lesson_assignments_pkey ON public.lesson_assignments USING btree (group_id, lesson_id, start_date);

CREATE UNIQUE INDEX lesson_links_pkey ON public.lesson_links USING btree (lesson_link_id);

CREATE UNIQUE INDEX lessons_learning_objective_pkey ON public.lessons_learning_objective USING btree (learning_objective_id, lesson_id);

CREATE UNIQUE INDEX lessons_pkey ON public.lessons USING btree (lesson_id);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (user_id);

CREATE UNIQUE INDEX subjects_pkey ON public.subjects USING btree (subject);

CREATE INDEX success_criteria_learning_objective_idx ON public.success_criteria USING btree (learning_objective_id, order_index);

CREATE UNIQUE INDEX success_criteria_pkey ON public.success_criteria USING btree (success_criteria_id);

CREATE UNIQUE INDEX success_criteria_units_pkey ON public.success_criteria_units USING btree (success_criteria_id, unit_id);

CREATE UNIQUE INDEX units_pkey ON public.units USING btree (unit_id);

alter table "public"."activities" add constraint "activities_pkey" PRIMARY KEY using index "activities_pkey";

alter table "public"."assessment_objectives" add constraint "assessment_objectives_pkey" PRIMARY KEY using index "assessment_objectives_pkey";

alter table "public"."assignments" add constraint "assignments_pkey" PRIMARY KEY using index "assignments_pkey";

alter table "public"."curricula" add constraint "curricula_pkey" PRIMARY KEY using index "curricula_pkey";

alter table "public"."feedback" add constraint "feedback_pkey" PRIMARY KEY using index "feedback_pkey";

alter table "public"."groups" add constraint "groups_pkey" PRIMARY KEY using index "groups_pkey";

alter table "public"."learning_objectives" add constraint "learning_objectives_pkey" PRIMARY KEY using index "learning_objectives_pkey";

alter table "public"."lesson_assignments" add constraint "lesson_assignments_pkey" PRIMARY KEY using index "lesson_assignments_pkey";

alter table "public"."lesson_links" add constraint "lesson_links_pkey" PRIMARY KEY using index "lesson_links_pkey";

alter table "public"."lessons" add constraint "lessons_pkey" PRIMARY KEY using index "lessons_pkey";

alter table "public"."lessons_learning_objective" add constraint "lessons_learning_objective_pkey" PRIMARY KEY using index "lessons_learning_objective_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."subjects" add constraint "subjects_pkey" PRIMARY KEY using index "subjects_pkey";

alter table "public"."success_criteria" add constraint "success_criteria_pkey" PRIMARY KEY using index "success_criteria_pkey";

alter table "public"."success_criteria_units" add constraint "success_criteria_units_pkey" PRIMARY KEY using index "success_criteria_units_pkey";

alter table "public"."units" add constraint "units_pkey" PRIMARY KEY using index "units_pkey";

alter table "public"."activities" add constraint "activities_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) not valid;

alter table "public"."activities" validate constraint "activities_lesson_id_fkey";

alter table "public"."assessment_objectives" add constraint "assessment_objectives_curriculum_id_code_key" UNIQUE using index "assessment_objectives_curriculum_id_code_key";

alter table "public"."assessment_objectives" add constraint "assessment_objectives_curriculum_id_fkey" FOREIGN KEY (curriculum_id) REFERENCES curricula(curriculum_id) ON DELETE CASCADE not valid;

alter table "public"."assessment_objectives" validate constraint "assessment_objectives_curriculum_id_fkey";

alter table "public"."assessment_objectives" add constraint "assessment_objectives_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES units(unit_id) ON DELETE CASCADE not valid;

alter table "public"."assessment_objectives" validate constraint "assessment_objectives_unit_id_fkey";

alter table "public"."assessment_objectives" add constraint "assessment_objectives_unit_id_key" UNIQUE using index "assessment_objectives_unit_id_key";

alter table "public"."curricula" add constraint "curricula_subject_fkey" FOREIGN KEY (subject) REFERENCES subjects(subject) ON DELETE SET NULL not valid;

alter table "public"."curricula" validate constraint "curricula_subject_fkey";

alter table "public"."group_membership" add constraint "group_membership_group_id_fkey" FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE not valid;

alter table "public"."group_membership" validate constraint "group_membership_group_id_fkey";

alter table "public"."learning_objectives" add constraint "learning_objectives_assessment_objective_id_fkey" FOREIGN KEY (assessment_objective_id) REFERENCES assessment_objectives(assessment_objective_id) ON DELETE CASCADE not valid;

alter table "public"."learning_objectives" validate constraint "learning_objectives_assessment_objective_id_fkey";

alter table "public"."lesson_links" add constraint "lesson_links_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE not valid;

alter table "public"."lesson_links" validate constraint "lesson_links_lesson_id_fkey";

alter table "public"."lessons" add constraint "lessons_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES units(unit_id) ON DELETE CASCADE not valid;

alter table "public"."lessons" validate constraint "lessons_unit_id_fkey";

alter table "public"."lessons_learning_objective" add constraint "lessons_learning_objective_learning_objective_id_fkey" FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE not valid;

alter table "public"."lessons_learning_objective" validate constraint "lessons_learning_objective_learning_objective_id_fkey";

alter table "public"."lessons_learning_objective" add constraint "lessons_learning_objective_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE not valid;

alter table "public"."lessons_learning_objective" validate constraint "lessons_learning_objective_lesson_id_fkey";

alter table "public"."success_criteria" add constraint "success_criteria_learning_objective_id_fkey" FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE not valid;

alter table "public"."success_criteria" validate constraint "success_criteria_learning_objective_id_fkey";

alter table "public"."success_criteria_units" add constraint "success_criteria_units_success_criteria_id_fkey" FOREIGN KEY (success_criteria_id) REFERENCES success_criteria(success_criteria_id) ON DELETE CASCADE not valid;

alter table "public"."success_criteria_units" validate constraint "success_criteria_units_success_criteria_id_fkey";

alter table "public"."success_criteria_units" add constraint "success_criteria_units_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES units(unit_id) ON DELETE CASCADE not valid;

alter table "public"."success_criteria_units" validate constraint "success_criteria_units_unit_id_fkey";

alter table "public"."units" add constraint "units_subject_fkey" FOREIGN KEY (subject) REFERENCES subjects(subject) not valid;

alter table "public"."units" validate constraint "units_subject_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.set_learning_objectives_order_by()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  next_order integer;
BEGIN
  -- If order_by is provided AND positive, respect it; otherwise compute it
  IF COALESCE(NEW.order_by, 0) > 0 THEN
    RETURN NEW;
  END IF;

  -- Concurrency safety: transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('learning_objectives.order_by'));

  SELECT COALESCE(MAX(order_by), 0) + 1
    INTO next_order
  FROM learning_objectives;

  NEW.order_by := next_order;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_lessons_order_by()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  next_order integer;
BEGIN
  -- If order_by is provided AND positive, respect it; otherwise compute it
  IF COALESCE(NEW.order_by, 0) > 0 THEN
    RETURN NEW;
  END IF;

  -- Concurrency safety: transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('lessons.order_by'));

  SELECT COALESCE(MAX(order_by), 0) + 1
    INTO next_order
  FROM lessons;

  NEW.order_by := next_order;
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER trg_set_lessons_order_by BEFORE INSERT ON public.lessons FOR EACH ROW EXECUTE FUNCTION set_lessons_order_by();



  create policy "Give annon users access to folder 1ucepb_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (true);



  create policy "Give annon users access to folder 1ucepb_1"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (true);



  create policy "Give annon users access to folder 1ucepb_2"
  on "storage"."objects"
  as permissive
  for update
  to public
using (true);



  create policy "Give annon users access to folder 1ucepb_3"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (true);



