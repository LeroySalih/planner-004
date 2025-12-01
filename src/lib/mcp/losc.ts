import { query } from "@/lib/db"

type RawSuccessCriterionRow = {
  success_criteria_id?: string | null
  description?: string | null
  active?: boolean | null
  order_index?: number | null
}

type RawLearningObjectiveRow = {
  learning_objective_id?: string | null
  title?: string | null
  order_index?: number | null
  active?: boolean | null
  spec_ref?: string | null
  success_criteria?: RawSuccessCriterionRow[] | null
}

type RawAssessmentObjectiveRow = {
  learning_objectives?: RawLearningObjectiveRow[] | null
}

type RawCurriculumRow = {
  curriculum_id: string
  title?: string | null
  active?: boolean | null
  assessment_objectives?: RawAssessmentObjectiveRow[] | null
}

type SuccessCriterion = {
  success_criteria_id: string
  title: string
  active: boolean
  order_index: number
}

type LearningObjectiveWithScs = {
  learning_objective_id: string
  title: string
  active: boolean
  spec_ref: string | null
  order_index: number
  scs: SuccessCriterion[]
}

export type CurriculumLoscPayload = {
  curriculum_id: string
  title: string
  is_active: boolean
  learning_objectives: LearningObjectiveWithScs[]
}

export async function fetchCurriculumLosc(curriculumId: string): Promise<CurriculumLoscPayload | null> {
  const { rows } = await query(
    `
      select
        c.curriculum_id,
        c.title,
        c.active,
        ao.assessment_objective_id,
        lo.learning_objective_id,
        lo.title as lo_title,
        lo.order_index as lo_order_index,
        lo.active as lo_active,
        lo.spec_ref,
        sc.success_criteria_id,
        sc.description,
        sc.active as sc_active,
        sc.order_index as sc_order_index
      from curricula c
      left join assessment_objectives ao on ao.curriculum_id = c.curriculum_id
      left join learning_objectives lo on lo.assessment_objective_id = ao.assessment_objective_id
      left join success_criteria sc on sc.learning_objective_id = lo.learning_objective_id
      where c.curriculum_id = $1
      order by lo.order_index asc nulls last, sc.order_index asc nulls last
    `,
    [curriculumId],
  )

  if (!rows || rows.length === 0) {
    return null
  }

  const dataset = (rows ?? []) as Array<Record<string, unknown>>
  const firstRow = dataset[0]
  const rawData: RawCurriculumRow = {
    curriculum_id:
      typeof firstRow.curriculum_id === "string" ? firstRow.curriculum_id : String(firstRow.curriculum_id ?? ""),
    title: typeof firstRow.title === "string" ? firstRow.title : "",
    active: firstRow.active === true,
    assessment_objectives: [
      {
        learning_objectives: Array.from(
          dataset.reduce((map, row) => {
            const learningObjectiveId =
              typeof row.learning_objective_id === "string" ? row.learning_objective_id : null
            if (!learningObjectiveId) return map
            const existing = map.get(learningObjectiveId) ?? {
              learning_objective_id: learningObjectiveId,
              title: typeof row.lo_title === "string" ? row.lo_title : "",
              order_index: typeof row.lo_order_index === "number" ? row.lo_order_index : null,
              active: row.lo_active === true,
              spec_ref: typeof row.spec_ref === "string" ? row.spec_ref : null,
              success_criteria: [],
            }

            if (typeof row.success_criteria_id === "string") {
              existing.success_criteria = [
                ...(existing.success_criteria ?? []),
                {
                  success_criteria_id: row.success_criteria_id,
                  description: typeof row.description === "string" ? row.description : "",
                  active: row.sc_active === true,
                  order_index: typeof row.sc_order_index === "number" ? row.sc_order_index : null,
                },
              ]
            }

            map.set(learningObjectiveId, existing)
            return map
          }, new Map<string, RawLearningObjectiveRow>()).values(),
        ),
      },
    ],
  }

  const rawObjectives =
    (rawData.assessment_objectives ?? []).flatMap(
      (assessmentObjective) => assessmentObjective.learning_objectives ?? [],
    ) ?? []

  const seen = new Set<string>()

  const learningObjectives: LearningObjectiveWithScs[] = rawObjectives
    .map((objective: RawLearningObjectiveRow, index: number) => {
      const objectiveId = objective?.learning_objective_id ?? ""
      if (!objectiveId || seen.has(objectiveId)) {
        return null
      }
      seen.add(objectiveId)

      const scs: SuccessCriterion[] = (objective?.success_criteria ?? [])
        .map((criterion: RawSuccessCriterionRow, criterionIndex: number) => ({
          success_criteria_id: criterion?.success_criteria_id ?? "",
          title:
            typeof criterion?.description === "string" && criterion.description.length > 0
              ? criterion.description
              : `Success criterion ${criterionIndex + 1}`,
          active: typeof criterion?.active === "boolean" ? criterion.active : true,
          order_index: typeof criterion?.order_index === "number" ? criterion.order_index : criterionIndex,
        }))
        .filter((criterion) => Boolean(criterion.success_criteria_id))
        .sort((a, b) => a.order_index - b.order_index)

      return {
        learning_objective_id: objectiveId,
        title: typeof objective?.title === "string" ? objective.title : "Learning objective",
        active: typeof objective?.active === "boolean" ? objective.active : true,
        spec_ref:
          typeof objective?.spec_ref === "string" && objective.spec_ref.trim().length > 0
            ? objective.spec_ref.trim()
            : null,
        order_index: typeof objective?.order_index === "number" ? objective.order_index : index,
        scs,
      }
    })
    .filter((objective): objective is LearningObjectiveWithScs => Boolean(objective?.learning_objective_id))
    .sort((a, b) => a.order_index - b.order_index)

  return {
    curriculum_id: rawData.curriculum_id,
    title: typeof rawData.title === "string" ? rawData.title : "",
    is_active: typeof rawData.active === "boolean" ? rawData.active : false,
    learning_objectives: learningObjectives,
  }
}
