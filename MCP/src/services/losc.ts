import { getSupabaseServiceClient } from '../supabase.js';

type RawSuccessCriterionRow = {
  success_criteria_id?: string | null;
  description?: string | null;
  active?: boolean | null;
  order_index?: number | null;
};

type RawLearningObjectiveRow = {
  learning_objective_id?: string | null;
  title?: string | null;
  order_index?: number | null;
  active?: boolean | null;
  spec_ref?: string | null;
  success_criteria?: RawSuccessCriterionRow[] | null;
};

type RawAssessmentObjectiveRow = {
  learning_objectives?: RawLearningObjectiveRow[] | null;
};

type RawCurriculumRow = {
  curriculum_id: string;
  title?: string | null;
  active?: boolean | null;
  assessment_objectives?: RawAssessmentObjectiveRow[] | null;
};

export type SuccessCriterion = {
  success_criteria_id: string;
  title: string;
  active: boolean;
  order_index: number;
};

export type LearningObjectiveWithScs = {
  learning_objective_id: string;
  title: string;
  active: boolean;
  spec_ref: string | null;
  order_index: number;
  scs: SuccessCriterion[];
};

export type CurriculumLoscPayload = {
  curriculum_id: string;
  title: string;
  is_active: boolean;
  learning_objectives: LearningObjectiveWithScs[];
};

export async function fetchCurriculumLosc(
  curriculumId: string
): Promise<CurriculumLoscPayload | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('curricula')
    .select(
      `
        curriculum_id,
        title,
        active,
        assessment_objectives(
          assessment_objective_id,
          learning_objectives(
            learning_objective_id,
            title,
            order_index,
            active,
            spec_ref,
            success_criteria(
              success_criteria_id,
              description,
              active,
              order_index
            )
          )
        )
      `
    )
    .eq('curriculum_id', curriculumId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load curriculum LO/SC: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  console.log("Returned raw LO/SC data:", JSON.stringify(data, null, 2));

  const rawData = data as RawCurriculumRow;

  const rawObjectives =
    (rawData.assessment_objectives ?? []).flatMap(
      assessmentObjective => assessmentObjective.learning_objectives ?? []
    ) ?? [];

  const seen = new Set<string>();

  const learningObjectives: LearningObjectiveWithScs[] = rawObjectives
    .map((objective: RawLearningObjectiveRow, index: number) => {
      const objectiveId = objective?.learning_objective_id ?? '';
      if (!objectiveId || seen.has(objectiveId)) {
        return null;
      }
      seen.add(objectiveId);

      const scs: SuccessCriterion[] = (objective?.success_criteria ?? [])
        .map((criterion: RawSuccessCriterionRow, criterionIndex: number) => ({
          success_criteria_id: criterion?.success_criteria_id ?? '',
          title:
            typeof criterion?.description === 'string' && criterion.description.length > 0
              ? criterion.description
              : `Success criterion ${criterionIndex + 1}`,
          active: typeof criterion?.active === 'boolean' ? criterion.active : true,
          order_index: typeof criterion?.order_index === 'number' ? criterion.order_index : criterionIndex
        }))
        .filter(criterion => Boolean(criterion.success_criteria_id))
        .sort((a, b) => a.order_index - b.order_index);

      return {
        learning_objective_id: objectiveId,
        title: typeof objective?.title === 'string' ? objective.title : 'Learning objective',
        active: typeof objective?.active === 'boolean' ? objective.active : true,
        spec_ref:
          typeof objective?.spec_ref === 'string' && objective.spec_ref.trim().length > 0
            ? objective.spec_ref.trim()
            : null,
        order_index: typeof objective?.order_index === 'number' ? objective.order_index : index,
        scs
      };
    })
    .filter((objective): objective is LearningObjectiveWithScs => Boolean(objective?.learning_objective_id))
    .sort((a, b) => a.order_index - b.order_index);

  return {
    curriculum_id: rawData.curriculum_id,
    title: typeof rawData.title === 'string' ? rawData.title : '',
    is_active: typeof rawData.active === 'boolean' ? rawData.active : false,
    learning_objectives: learningObjectives
  };
}
