alter table "public"."activities" add column "is_summative" boolean default false;

alter table "public"."activities" add column "notes" text;

grant delete on table "public"."activities" to "anon";

grant insert on table "public"."activities" to "anon";

grant references on table "public"."activities" to "anon";

grant select on table "public"."activities" to "anon";

grant trigger on table "public"."activities" to "anon";

grant truncate on table "public"."activities" to "anon";

grant update on table "public"."activities" to "anon";

grant delete on table "public"."activities" to "authenticated";

grant insert on table "public"."activities" to "authenticated";

grant references on table "public"."activities" to "authenticated";

grant select on table "public"."activities" to "authenticated";

grant trigger on table "public"."activities" to "authenticated";

grant truncate on table "public"."activities" to "authenticated";

grant update on table "public"."activities" to "authenticated";

grant delete on table "public"."activities" to "service_role";

grant insert on table "public"."activities" to "service_role";

grant references on table "public"."activities" to "service_role";

grant select on table "public"."activities" to "service_role";

grant trigger on table "public"."activities" to "service_role";

grant truncate on table "public"."activities" to "service_role";

grant update on table "public"."activities" to "service_role";

grant delete on table "public"."assessment_objectives" to "anon";

grant insert on table "public"."assessment_objectives" to "anon";

grant references on table "public"."assessment_objectives" to "anon";

grant select on table "public"."assessment_objectives" to "anon";

grant trigger on table "public"."assessment_objectives" to "anon";

grant truncate on table "public"."assessment_objectives" to "anon";

grant update on table "public"."assessment_objectives" to "anon";

grant delete on table "public"."assessment_objectives" to "authenticated";

grant insert on table "public"."assessment_objectives" to "authenticated";

grant references on table "public"."assessment_objectives" to "authenticated";

grant select on table "public"."assessment_objectives" to "authenticated";

grant trigger on table "public"."assessment_objectives" to "authenticated";

grant truncate on table "public"."assessment_objectives" to "authenticated";

grant update on table "public"."assessment_objectives" to "authenticated";

grant delete on table "public"."assessment_objectives" to "service_role";

grant insert on table "public"."assessment_objectives" to "service_role";

grant references on table "public"."assessment_objectives" to "service_role";

grant select on table "public"."assessment_objectives" to "service_role";

grant trigger on table "public"."assessment_objectives" to "service_role";

grant truncate on table "public"."assessment_objectives" to "service_role";

grant update on table "public"."assessment_objectives" to "service_role";

grant delete on table "public"."assignments" to "anon";

grant insert on table "public"."assignments" to "anon";

grant references on table "public"."assignments" to "anon";

grant select on table "public"."assignments" to "anon";

grant trigger on table "public"."assignments" to "anon";

grant truncate on table "public"."assignments" to "anon";

grant update on table "public"."assignments" to "anon";

grant delete on table "public"."assignments" to "authenticated";

grant insert on table "public"."assignments" to "authenticated";

grant references on table "public"."assignments" to "authenticated";

grant select on table "public"."assignments" to "authenticated";

grant trigger on table "public"."assignments" to "authenticated";

grant truncate on table "public"."assignments" to "authenticated";

grant update on table "public"."assignments" to "authenticated";

grant delete on table "public"."assignments" to "service_role";

grant insert on table "public"."assignments" to "service_role";

grant references on table "public"."assignments" to "service_role";

grant select on table "public"."assignments" to "service_role";

grant trigger on table "public"."assignments" to "service_role";

grant truncate on table "public"."assignments" to "service_role";

grant update on table "public"."assignments" to "service_role";

grant delete on table "public"."curricula" to "anon";

grant insert on table "public"."curricula" to "anon";

grant references on table "public"."curricula" to "anon";

grant select on table "public"."curricula" to "anon";

grant trigger on table "public"."curricula" to "anon";

grant truncate on table "public"."curricula" to "anon";

grant update on table "public"."curricula" to "anon";

grant delete on table "public"."curricula" to "authenticated";

grant insert on table "public"."curricula" to "authenticated";

grant references on table "public"."curricula" to "authenticated";

grant select on table "public"."curricula" to "authenticated";

grant trigger on table "public"."curricula" to "authenticated";

grant truncate on table "public"."curricula" to "authenticated";

grant update on table "public"."curricula" to "authenticated";

grant delete on table "public"."curricula" to "service_role";

grant insert on table "public"."curricula" to "service_role";

grant references on table "public"."curricula" to "service_role";

grant select on table "public"."curricula" to "service_role";

grant trigger on table "public"."curricula" to "service_role";

grant truncate on table "public"."curricula" to "service_role";

grant update on table "public"."curricula" to "service_role";

grant delete on table "public"."feedback" to "anon";

grant insert on table "public"."feedback" to "anon";

grant references on table "public"."feedback" to "anon";

grant select on table "public"."feedback" to "anon";

grant trigger on table "public"."feedback" to "anon";

grant truncate on table "public"."feedback" to "anon";

grant update on table "public"."feedback" to "anon";

grant delete on table "public"."feedback" to "authenticated";

grant insert on table "public"."feedback" to "authenticated";

grant references on table "public"."feedback" to "authenticated";

grant select on table "public"."feedback" to "authenticated";

grant trigger on table "public"."feedback" to "authenticated";

grant truncate on table "public"."feedback" to "authenticated";

grant update on table "public"."feedback" to "authenticated";

grant delete on table "public"."feedback" to "service_role";

grant insert on table "public"."feedback" to "service_role";

grant references on table "public"."feedback" to "service_role";

grant select on table "public"."feedback" to "service_role";

grant trigger on table "public"."feedback" to "service_role";

grant truncate on table "public"."feedback" to "service_role";

grant update on table "public"."feedback" to "service_role";

grant delete on table "public"."group_membership" to "anon";

grant insert on table "public"."group_membership" to "anon";

grant references on table "public"."group_membership" to "anon";

grant select on table "public"."group_membership" to "anon";

grant trigger on table "public"."group_membership" to "anon";

grant truncate on table "public"."group_membership" to "anon";

grant update on table "public"."group_membership" to "anon";

grant delete on table "public"."group_membership" to "authenticated";

grant insert on table "public"."group_membership" to "authenticated";

grant references on table "public"."group_membership" to "authenticated";

grant select on table "public"."group_membership" to "authenticated";

grant trigger on table "public"."group_membership" to "authenticated";

grant truncate on table "public"."group_membership" to "authenticated";

grant update on table "public"."group_membership" to "authenticated";

grant delete on table "public"."group_membership" to "service_role";

grant insert on table "public"."group_membership" to "service_role";

grant references on table "public"."group_membership" to "service_role";

grant select on table "public"."group_membership" to "service_role";

grant trigger on table "public"."group_membership" to "service_role";

grant truncate on table "public"."group_membership" to "service_role";

grant update on table "public"."group_membership" to "service_role";

grant delete on table "public"."groups" to "anon";

grant insert on table "public"."groups" to "anon";

grant references on table "public"."groups" to "anon";

grant select on table "public"."groups" to "anon";

grant trigger on table "public"."groups" to "anon";

grant truncate on table "public"."groups" to "anon";

grant update on table "public"."groups" to "anon";

grant delete on table "public"."groups" to "authenticated";

grant insert on table "public"."groups" to "authenticated";

grant references on table "public"."groups" to "authenticated";

grant select on table "public"."groups" to "authenticated";

grant trigger on table "public"."groups" to "authenticated";

grant truncate on table "public"."groups" to "authenticated";

grant update on table "public"."groups" to "authenticated";

grant delete on table "public"."groups" to "service_role";

grant insert on table "public"."groups" to "service_role";

grant references on table "public"."groups" to "service_role";

grant select on table "public"."groups" to "service_role";

grant trigger on table "public"."groups" to "service_role";

grant truncate on table "public"."groups" to "service_role";

grant update on table "public"."groups" to "service_role";

grant delete on table "public"."learning_objectives" to "anon";

grant insert on table "public"."learning_objectives" to "anon";

grant references on table "public"."learning_objectives" to "anon";

grant select on table "public"."learning_objectives" to "anon";

grant trigger on table "public"."learning_objectives" to "anon";

grant truncate on table "public"."learning_objectives" to "anon";

grant update on table "public"."learning_objectives" to "anon";

grant delete on table "public"."learning_objectives" to "authenticated";

grant insert on table "public"."learning_objectives" to "authenticated";

grant references on table "public"."learning_objectives" to "authenticated";

grant select on table "public"."learning_objectives" to "authenticated";

grant trigger on table "public"."learning_objectives" to "authenticated";

grant truncate on table "public"."learning_objectives" to "authenticated";

grant update on table "public"."learning_objectives" to "authenticated";

grant delete on table "public"."learning_objectives" to "service_role";

grant insert on table "public"."learning_objectives" to "service_role";

grant references on table "public"."learning_objectives" to "service_role";

grant select on table "public"."learning_objectives" to "service_role";

grant trigger on table "public"."learning_objectives" to "service_role";

grant truncate on table "public"."learning_objectives" to "service_role";

grant update on table "public"."learning_objectives" to "service_role";

grant delete on table "public"."lesson_assignments" to "anon";

grant insert on table "public"."lesson_assignments" to "anon";

grant references on table "public"."lesson_assignments" to "anon";

grant select on table "public"."lesson_assignments" to "anon";

grant trigger on table "public"."lesson_assignments" to "anon";

grant truncate on table "public"."lesson_assignments" to "anon";

grant update on table "public"."lesson_assignments" to "anon";

grant delete on table "public"."lesson_assignments" to "authenticated";

grant insert on table "public"."lesson_assignments" to "authenticated";

grant references on table "public"."lesson_assignments" to "authenticated";

grant select on table "public"."lesson_assignments" to "authenticated";

grant trigger on table "public"."lesson_assignments" to "authenticated";

grant truncate on table "public"."lesson_assignments" to "authenticated";

grant update on table "public"."lesson_assignments" to "authenticated";

grant delete on table "public"."lesson_assignments" to "service_role";

grant insert on table "public"."lesson_assignments" to "service_role";

grant references on table "public"."lesson_assignments" to "service_role";

grant select on table "public"."lesson_assignments" to "service_role";

grant trigger on table "public"."lesson_assignments" to "service_role";

grant truncate on table "public"."lesson_assignments" to "service_role";

grant update on table "public"."lesson_assignments" to "service_role";

grant delete on table "public"."lesson_links" to "anon";

grant insert on table "public"."lesson_links" to "anon";

grant references on table "public"."lesson_links" to "anon";

grant select on table "public"."lesson_links" to "anon";

grant trigger on table "public"."lesson_links" to "anon";

grant truncate on table "public"."lesson_links" to "anon";

grant update on table "public"."lesson_links" to "anon";

grant delete on table "public"."lesson_links" to "authenticated";

grant insert on table "public"."lesson_links" to "authenticated";

grant references on table "public"."lesson_links" to "authenticated";

grant select on table "public"."lesson_links" to "authenticated";

grant trigger on table "public"."lesson_links" to "authenticated";

grant truncate on table "public"."lesson_links" to "authenticated";

grant update on table "public"."lesson_links" to "authenticated";

grant delete on table "public"."lesson_links" to "service_role";

grant insert on table "public"."lesson_links" to "service_role";

grant references on table "public"."lesson_links" to "service_role";

grant select on table "public"."lesson_links" to "service_role";

grant trigger on table "public"."lesson_links" to "service_role";

grant truncate on table "public"."lesson_links" to "service_role";

grant update on table "public"."lesson_links" to "service_role";

grant delete on table "public"."lessons" to "anon";

grant insert on table "public"."lessons" to "anon";

grant references on table "public"."lessons" to "anon";

grant select on table "public"."lessons" to "anon";

grant trigger on table "public"."lessons" to "anon";

grant truncate on table "public"."lessons" to "anon";

grant update on table "public"."lessons" to "anon";

grant delete on table "public"."lessons" to "authenticated";

grant insert on table "public"."lessons" to "authenticated";

grant references on table "public"."lessons" to "authenticated";

grant select on table "public"."lessons" to "authenticated";

grant trigger on table "public"."lessons" to "authenticated";

grant truncate on table "public"."lessons" to "authenticated";

grant update on table "public"."lessons" to "authenticated";

grant delete on table "public"."lessons" to "service_role";

grant insert on table "public"."lessons" to "service_role";

grant references on table "public"."lessons" to "service_role";

grant select on table "public"."lessons" to "service_role";

grant trigger on table "public"."lessons" to "service_role";

grant truncate on table "public"."lessons" to "service_role";

grant update on table "public"."lessons" to "service_role";

grant delete on table "public"."lessons_learning_objective" to "anon";

grant insert on table "public"."lessons_learning_objective" to "anon";

grant references on table "public"."lessons_learning_objective" to "anon";

grant select on table "public"."lessons_learning_objective" to "anon";

grant trigger on table "public"."lessons_learning_objective" to "anon";

grant truncate on table "public"."lessons_learning_objective" to "anon";

grant update on table "public"."lessons_learning_objective" to "anon";

grant delete on table "public"."lessons_learning_objective" to "authenticated";

grant insert on table "public"."lessons_learning_objective" to "authenticated";

grant references on table "public"."lessons_learning_objective" to "authenticated";

grant select on table "public"."lessons_learning_objective" to "authenticated";

grant trigger on table "public"."lessons_learning_objective" to "authenticated";

grant truncate on table "public"."lessons_learning_objective" to "authenticated";

grant update on table "public"."lessons_learning_objective" to "authenticated";

grant delete on table "public"."lessons_learning_objective" to "service_role";

grant insert on table "public"."lessons_learning_objective" to "service_role";

grant references on table "public"."lessons_learning_objective" to "service_role";

grant select on table "public"."lessons_learning_objective" to "service_role";

grant trigger on table "public"."lessons_learning_objective" to "service_role";

grant truncate on table "public"."lessons_learning_objective" to "service_role";

grant update on table "public"."lessons_learning_objective" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."subjects" to "anon";

grant insert on table "public"."subjects" to "anon";

grant references on table "public"."subjects" to "anon";

grant select on table "public"."subjects" to "anon";

grant trigger on table "public"."subjects" to "anon";

grant truncate on table "public"."subjects" to "anon";

grant update on table "public"."subjects" to "anon";

grant delete on table "public"."subjects" to "authenticated";

grant insert on table "public"."subjects" to "authenticated";

grant references on table "public"."subjects" to "authenticated";

grant select on table "public"."subjects" to "authenticated";

grant trigger on table "public"."subjects" to "authenticated";

grant truncate on table "public"."subjects" to "authenticated";

grant update on table "public"."subjects" to "authenticated";

grant delete on table "public"."subjects" to "service_role";

grant insert on table "public"."subjects" to "service_role";

grant references on table "public"."subjects" to "service_role";

grant select on table "public"."subjects" to "service_role";

grant trigger on table "public"."subjects" to "service_role";

grant truncate on table "public"."subjects" to "service_role";

grant update on table "public"."subjects" to "service_role";

grant delete on table "public"."success_criteria" to "anon";

grant insert on table "public"."success_criteria" to "anon";

grant references on table "public"."success_criteria" to "anon";

grant select on table "public"."success_criteria" to "anon";

grant trigger on table "public"."success_criteria" to "anon";

grant truncate on table "public"."success_criteria" to "anon";

grant update on table "public"."success_criteria" to "anon";

grant delete on table "public"."success_criteria" to "authenticated";

grant insert on table "public"."success_criteria" to "authenticated";

grant references on table "public"."success_criteria" to "authenticated";

grant select on table "public"."success_criteria" to "authenticated";

grant trigger on table "public"."success_criteria" to "authenticated";

grant truncate on table "public"."success_criteria" to "authenticated";

grant update on table "public"."success_criteria" to "authenticated";

grant delete on table "public"."success_criteria" to "service_role";

grant insert on table "public"."success_criteria" to "service_role";

grant references on table "public"."success_criteria" to "service_role";

grant select on table "public"."success_criteria" to "service_role";

grant trigger on table "public"."success_criteria" to "service_role";

grant truncate on table "public"."success_criteria" to "service_role";

grant update on table "public"."success_criteria" to "service_role";

grant delete on table "public"."success_criteria_units" to "anon";

grant insert on table "public"."success_criteria_units" to "anon";

grant references on table "public"."success_criteria_units" to "anon";

grant select on table "public"."success_criteria_units" to "anon";

grant trigger on table "public"."success_criteria_units" to "anon";

grant truncate on table "public"."success_criteria_units" to "anon";

grant update on table "public"."success_criteria_units" to "anon";

grant delete on table "public"."success_criteria_units" to "authenticated";

grant insert on table "public"."success_criteria_units" to "authenticated";

grant references on table "public"."success_criteria_units" to "authenticated";

grant select on table "public"."success_criteria_units" to "authenticated";

grant trigger on table "public"."success_criteria_units" to "authenticated";

grant truncate on table "public"."success_criteria_units" to "authenticated";

grant update on table "public"."success_criteria_units" to "authenticated";

grant delete on table "public"."success_criteria_units" to "service_role";

grant insert on table "public"."success_criteria_units" to "service_role";

grant references on table "public"."success_criteria_units" to "service_role";

grant select on table "public"."success_criteria_units" to "service_role";

grant trigger on table "public"."success_criteria_units" to "service_role";

grant truncate on table "public"."success_criteria_units" to "service_role";

grant update on table "public"."success_criteria_units" to "service_role";

grant delete on table "public"."units" to "anon";

grant insert on table "public"."units" to "anon";

grant references on table "public"."units" to "anon";

grant select on table "public"."units" to "anon";

grant trigger on table "public"."units" to "anon";

grant truncate on table "public"."units" to "anon";

grant update on table "public"."units" to "anon";

grant delete on table "public"."units" to "authenticated";

grant insert on table "public"."units" to "authenticated";

grant references on table "public"."units" to "authenticated";

grant select on table "public"."units" to "authenticated";

grant trigger on table "public"."units" to "authenticated";

grant truncate on table "public"."units" to "authenticated";

grant update on table "public"."units" to "authenticated";

grant delete on table "public"."units" to "service_role";

grant insert on table "public"."units" to "service_role";

grant references on table "public"."units" to "service_role";

grant select on table "public"."units" to "service_role";

grant trigger on table "public"."units" to "service_role";

grant truncate on table "public"."units" to "service_role";

grant update on table "public"."units" to "service_role";


