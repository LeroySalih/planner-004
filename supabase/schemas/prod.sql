


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."set_learning_objectives_order_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."set_learning_objectives_order_by"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_lessons_order_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."set_lessons_order_by"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "activity_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "lesson_id" "text",
    "title" "text",
    "type" "text",
    "body_data" "jsonb",
    "is_homework" boolean DEFAULT false,
    "order_by" integer,
    "active" boolean DEFAULT true,
    "is_summative" boolean DEFAULT false,
    "notes" "text"
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessment_objectives" (
    "assessment_objective_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "curriculum_id" "text",
    "unit_id" "text",
    "code" "text" NOT NULL,
    "title" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."assessment_objectives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "group_id" "text" NOT NULL,
    "unit_id" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."curricula" (
    "curriculum_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."curricula" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" integer NOT NULL,
    "user_id" "text" NOT NULL,
    "lesson_id" "text" NOT NULL,
    "success_criteria_id" "text" NOT NULL,
    "rating" integer NOT NULL
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."feedback_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."feedback_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."feedback_id_seq" OWNED BY "public"."feedback"."id";



CREATE TABLE IF NOT EXISTS "public"."group_membership" (
    "group_id" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "role" "text" NOT NULL
);


ALTER TABLE "public"."group_membership" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "group_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "join_code" "text",
    "subject" "text",
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_objectives" (
    "learning_objective_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "assessment_objective_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."learning_objectives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_assignments" (
    "group_id" "text" NOT NULL,
    "lesson_id" "text" NOT NULL,
    "start_date" "date" NOT NULL
);


ALTER TABLE "public"."lesson_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_links" (
    "lesson_link_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "lesson_id" "text",
    "url" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."lesson_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lessons" (
    "lesson_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "order_by" integer NOT NULL
);


ALTER TABLE "public"."lessons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lessons_learning_objective" (
    "learning_objective_id" "text" NOT NULL,
    "lesson_id" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "title" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "order_by" integer NOT NULL
);


ALTER TABLE "public"."lessons_learning_objective" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "is_teacher" boolean DEFAULT false
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subjects" (
    "subject" "text" NOT NULL,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."success_criteria" (
    "success_criteria_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "learning_objective_id" "text" NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "description" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."success_criteria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."success_criteria_units" (
    "success_criteria_id" "text" NOT NULL,
    "unit_id" "text" NOT NULL
);


ALTER TABLE "public"."success_criteria_units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."units" (
    "unit_id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text",
    "subject" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "description" character varying,
    "year" integer
);

CREATE TABLE IF NOT EXISTS "public"."activity_success_criteria"(
    "activity_id" "text" NOT NULL,
    "success_criteria_id" "text" NOT NULL,
    PRIMARY KEY ("activity_id", "success_criteria_id")
);

CREATE TABLE IF NOT EXISTS "public"."lesson_success_criteria"(
    "lesson_id" "text" NOT NULL,
    "success_criteria_id" "text" NOT NULL,
    PRIMARY KEY ("lesson_id", "success_criteria_id")
);


ALTER TABLE "public"."units" OWNER TO "postgres";


ALTER TABLE ONLY "public"."feedback" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."feedback_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("activity_id");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_curriculum_id_code_key" UNIQUE ("curriculum_id", "code");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_pkey" PRIMARY KEY ("assessment_objective_id");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_unit_id_key" UNIQUE ("unit_id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("group_id", "unit_id", "start_date");



ALTER TABLE ONLY "public"."curricula"
    ADD CONSTRAINT "curricula_pkey" PRIMARY KEY ("curriculum_id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("group_id");



ALTER TABLE ONLY "public"."learning_objectives"
    ADD CONSTRAINT "learning_objectives_pkey" PRIMARY KEY ("learning_objective_id");



ALTER TABLE ONLY "public"."lesson_assignments"
    ADD CONSTRAINT "lesson_assignments_pkey" PRIMARY KEY ("group_id", "lesson_id", "start_date");



ALTER TABLE ONLY "public"."lesson_links"
    ADD CONSTRAINT "lesson_links_pkey" PRIMARY KEY ("lesson_link_id");



ALTER TABLE ONLY "public"."lessons_learning_objective"
    ADD CONSTRAINT "lessons_learning_objective_pkey" PRIMARY KEY ("learning_objective_id", "lesson_id");



ALTER TABLE ONLY "public"."lessons"
    ADD CONSTRAINT "lessons_pkey" PRIMARY KEY ("lesson_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_pkey" PRIMARY KEY ("subject");



ALTER TABLE ONLY "public"."success_criteria"
    ADD CONSTRAINT "success_criteria_pkey" PRIMARY KEY ("success_criteria_id");



ALTER TABLE ONLY "public"."success_criteria_units"
    ADD CONSTRAINT "success_criteria_units_pkey" PRIMARY KEY ("success_criteria_id", "unit_id");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY ("unit_id");



CREATE INDEX "assessment_objectives_curriculum_id_idx" ON "public"."assessment_objectives" USING "btree" ("curriculum_id");



CREATE UNIQUE INDEX "feedback_unique_user_lesson_criterion" ON "public"."feedback" USING "btree" ("user_id", "lesson_id", "success_criteria_id");



CREATE INDEX "learning_objectives_assessment_objective_id_idx" ON "public"."learning_objectives" USING "btree" ("assessment_objective_id", "order_index");



CREATE INDEX "success_criteria_learning_objective_idx" ON "public"."success_criteria" USING "btree" ("learning_objective_id", "order_index");



CREATE OR REPLACE TRIGGER "trg_set_lessons_order_by" BEFORE INSERT ON "public"."lessons" FOR EACH ROW EXECUTE FUNCTION "public"."set_lessons_order_by"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("lesson_id");



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("curriculum_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessment_objectives"
    ADD CONSTRAINT "assessment_objectives_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."curricula"
    ADD CONSTRAINT "curricula_subject_fkey" FOREIGN KEY ("subject") REFERENCES "public"."subjects"("subject") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_membership"
    ADD CONSTRAINT "group_membership_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("group_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_objectives"
    ADD CONSTRAINT "learning_objectives_assessment_objective_id_fkey" FOREIGN KEY ("assessment_objective_id") REFERENCES "public"."assessment_objectives"("assessment_objective_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lesson_links"
    ADD CONSTRAINT "lesson_links_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("lesson_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lessons_learning_objective"
    ADD CONSTRAINT "lessons_learning_objective_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "public"."learning_objectives"("learning_objective_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lessons_learning_objective"
    ADD CONSTRAINT "lessons_learning_objective_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("lesson_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lessons"
    ADD CONSTRAINT "lessons_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."success_criteria"
    ADD CONSTRAINT "success_criteria_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "public"."learning_objectives"("learning_objective_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."success_criteria_units"
    ADD CONSTRAINT "success_criteria_units_success_criteria_id_fkey" FOREIGN KEY ("success_criteria_id") REFERENCES "public"."success_criteria"("success_criteria_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."success_criteria_units"
    ADD CONSTRAINT "success_criteria_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_subject_fkey" FOREIGN KEY ("subject") REFERENCES "public"."subjects"("subject");



CREATE POLICY "Insert - Authenticated" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert - Authenticated Only" ON "public"."curricula" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Select - All" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Select - Authenticated Only" ON "public"."curricula" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Update - Authenticated Only" ON "public"."curricula" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update - Authenticated Only" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."curricula" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_learning_objectives_order_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_learning_objectives_order_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_learning_objectives_order_by"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_lessons_order_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_lessons_order_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_lessons_order_by"() TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_objectives" TO "anon";
GRANT ALL ON TABLE "public"."assessment_objectives" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_objectives" TO "service_role";



GRANT ALL ON TABLE "public"."assignments" TO "anon";
GRANT ALL ON TABLE "public"."assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."assignments" TO "service_role";



GRANT ALL ON TABLE "public"."curricula" TO "anon";
GRANT ALL ON TABLE "public"."curricula" TO "authenticated";
GRANT ALL ON TABLE "public"."curricula" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feedback_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feedback_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feedback_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."group_membership" TO "anon";
GRANT ALL ON TABLE "public"."group_membership" TO "authenticated";
GRANT ALL ON TABLE "public"."group_membership" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."learning_objectives" TO "anon";
GRANT ALL ON TABLE "public"."learning_objectives" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_objectives" TO "service_role";



GRANT ALL ON TABLE "public"."lesson_assignments" TO "anon";
GRANT ALL ON TABLE "public"."lesson_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."lesson_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."lesson_links" TO "anon";
GRANT ALL ON TABLE "public"."lesson_links" TO "authenticated";
GRANT ALL ON TABLE "public"."lesson_links" TO "service_role";



GRANT ALL ON TABLE "public"."lessons" TO "anon";
GRANT ALL ON TABLE "public"."lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."lessons" TO "service_role";



GRANT ALL ON TABLE "public"."lessons_learning_objective" TO "anon";
GRANT ALL ON TABLE "public"."lessons_learning_objective" TO "authenticated";
GRANT ALL ON TABLE "public"."lessons_learning_objective" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."subjects" TO "anon";
GRANT ALL ON TABLE "public"."subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."subjects" TO "service_role";



GRANT ALL ON TABLE "public"."success_criteria" TO "anon";
GRANT ALL ON TABLE "public"."success_criteria" TO "authenticated";
GRANT ALL ON TABLE "public"."success_criteria" TO "service_role";



GRANT ALL ON TABLE "public"."success_criteria_units" TO "anon";
GRANT ALL ON TABLE "public"."success_criteria_units" TO "authenticated";
GRANT ALL ON TABLE "public"."success_criteria_units" TO "service_role";



GRANT ALL ON TABLE "public"."units" TO "anon";
GRANT ALL ON TABLE "public"."units" TO "authenticated";
GRANT ALL ON TABLE "public"."units" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







RESET ALL;
