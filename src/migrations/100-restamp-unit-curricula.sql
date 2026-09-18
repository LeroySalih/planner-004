-- 100-restamp-unit-curricula.sql
--
-- units.curriculum_id was stamped once, on a unit's first objective, and never
-- updated. Moving a learning objective to another curriculum in the curriculum
-- builder left every unit using it pointing at the old curriculum -- and the
-- unit then could not be fixed from the UI: the Edit dialog locks the field once
-- objectives are assigned, and Admin -> Unit Curricula only lists units whose
-- objectives span two curricula, which these no longer did.
--
-- moveLearningObjectiveAction now restamps as it moves (restampUnitCurricula in
-- src/lib/curriculum/unit-curriculum-guard.ts). This is the same rule applied
-- once to the units already out of step: a unit whose objectives all come from
-- ONE curriculum is pointed at that curriculum. It also stamps units that had
-- objectives but no curriculum recorded at all.
--
-- Units spanning two curricula are left alone; they are genuine conflicts and
-- Admin -> Unit Curricula lists them.
--
-- The CTE below must stay in step with UNIT_ITEMS_CTE in the guard module.

  with unit_items as (
    select u.unit_id, ao.curriculum_id, lo.learning_objective_id as lo_id, sc.success_criteria_id as sc_id
    from units u
    join success_criteria_units scu on scu.unit_id = u.unit_id
    join success_criteria sc on sc.success_criteria_id = scu.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id, lo.learning_objective_id, null
    from lessons l
    join lessons_learning_objective llo on llo.lesson_id = l.lesson_id
    join learning_objectives lo on lo.learning_objective_id = llo.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id, lo.learning_objective_id, sc.success_criteria_id
    from lessons l
    join lesson_success_criteria lsc on lsc.lesson_id = l.lesson_id
    join success_criteria sc on sc.success_criteria_id = lsc.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id, lo.learning_objective_id, sc.success_criteria_id
    from lessons l
    join activities a on a.lesson_id = l.lesson_id
    join activity_success_criteria asc2 on asc2.activity_id = a.activity_id
    join success_criteria sc on sc.success_criteria_id = asc2.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
  ),
  per_unit as (
    select unit_id, count(distinct curriculum_id) as curr_count from unit_items group by unit_id
  )
update units u
set curriculum_id = single.curriculum_id
from (
  select unit_id, min(curriculum_id) as curriculum_id
  from unit_items
  group by unit_id
  having count(distinct curriculum_id) = 1
) single
where u.unit_id = single.unit_id
  and u.curriculum_id is distinct from single.curriculum_id;
