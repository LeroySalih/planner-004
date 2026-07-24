import { query, withDbClient } from "@/lib/db"

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

export type AssessmentObjectiveRecord = {
  assessment_objective_id: string
  curriculum_id: string
  code: string
  title: string
  order_index: number
}

export async function createAssessmentObjective(
  curriculumId: string,
  code: string,
  title: string,
): Promise<AssessmentObjectiveRecord> {
  let result: AssessmentObjectiveRecord | null = null

  await withDbClient(async (client) => {
    const { rows: existsRows } = await client.query<{ curriculum_id: string }>(
      'select curriculum_id from curricula where curriculum_id = $1 limit 1',
      [curriculumId],
    )
    if (!existsRows[0]) throw new Error(`Curriculum ${curriculumId} not found`)

    const { rows: maxRows } = await client.query<{ order_index: number }>(
      'select order_index from assessment_objectives where curriculum_id = $1 order by order_index desc nulls last limit 1',
      [curriculumId],
    )
    const nextOrder = (maxRows[0]?.order_index ?? -1) + 1

    const { rows } = await client.query<{
      assessment_objective_id: string
      curriculum_id: string
      code: string
      title: string
      order_index: number
    }>(
      `insert into assessment_objectives (curriculum_id, code, title, order_index)
       values ($1, $2, $3, $4)
       returning assessment_objective_id, curriculum_id, code, title, order_index`,
      [curriculumId, code.trim(), title.trim(), nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create assessment objective')
    result = {
      assessment_objective_id: row.assessment_objective_id,
      curriculum_id: row.curriculum_id,
      code: row.code,
      title: row.title,
      order_index: row.order_index,
    }
  })

  if (!result) throw new Error('Failed to create assessment objective')
  return result
}

export type LearningObjectiveRecord = {
  learning_objective_id: string
  assessment_objective_id: string
  title: string
  spec_ref: string | null
  active: boolean
  order_index: number
}

export async function createLearningObjective(
  assessmentObjectiveId: string,
  title: string,
  specRef?: string | null,
): Promise<LearningObjectiveRecord> {
  let result: LearningObjectiveRecord | null = null

  await withDbClient(async (client) => {
    const { rows: existsRows } = await client.query<{ assessment_objective_id: string }>(
      'select assessment_objective_id from assessment_objectives where assessment_objective_id = $1 limit 1',
      [assessmentObjectiveId],
    )
    if (!existsRows[0]) throw new Error(`Assessment objective ${assessmentObjectiveId} not found`)

    const { rows: maxRows } = await client.query<{ order_index: number }>(
      'select order_index from learning_objectives where assessment_objective_id = $1 order by order_index desc nulls last limit 1',
      [assessmentObjectiveId],
    )
    const nextOrder = (maxRows[0]?.order_index ?? -1) + 1

    const { rows } = await client.query<{
      learning_objective_id: string
      assessment_objective_id: string
      title: string
      spec_ref: string | null
      active: boolean
      order_index: number
    }>(
      `insert into learning_objectives (assessment_objective_id, title, spec_ref, active, order_index)
       values ($1, $2, $3, true, $4)
       returning learning_objective_id, assessment_objective_id, title, spec_ref, active, order_index`,
      [assessmentObjectiveId, title.trim(), specRef?.trim() ?? null, nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create learning objective')
    result = {
      learning_objective_id: row.learning_objective_id,
      assessment_objective_id: row.assessment_objective_id,
      title: row.title,
      spec_ref: row.spec_ref,
      active: row.active,
      order_index: row.order_index,
    }
  })

  if (!result) throw new Error('Failed to create learning objective')
  return result
}

export type SuccessCriterionRecord = {
  success_criteria_id: string
  learning_objective_id: string
  description: string
  level: number
  order_index: number
  active: boolean
}

export async function createSuccessCriterion(
  learningObjectiveId: string,
  description: string,
  level: number,
): Promise<SuccessCriterionRecord> {
  let result: SuccessCriterionRecord | null = null

  await withDbClient(async (client) => {
    const { rows: existsRows } = await client.query<{ learning_objective_id: string }>(
      'select learning_objective_id from learning_objectives where learning_objective_id = $1 limit 1',
      [learningObjectiveId],
    )
    if (!existsRows[0]) throw new Error(`Learning objective ${learningObjectiveId} not found`)

    const { rows: maxRows } = await client.query<{ order_index: number }>(
      'select order_index from success_criteria where learning_objective_id = $1 order by order_index desc nulls last limit 1',
      [learningObjectiveId],
    )
    const nextOrder = (maxRows[0]?.order_index ?? -1) + 1

    const { rows } = await client.query<{
      success_criteria_id: string
      learning_objective_id: string
      description: string
      level: number
      order_index: number
      active: boolean
    }>(
      `insert into success_criteria (learning_objective_id, description, level, order_index, active)
       values ($1, $2, $3, $4, true)
       returning success_criteria_id, learning_objective_id, description, level, order_index, active`,
      [learningObjectiveId, description.trim(), level, nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create success criterion')
    result = {
      success_criteria_id: row.success_criteria_id,
      learning_objective_id: row.learning_objective_id,
      description: row.description,
      level: row.level,
      order_index: row.order_index,
      active: row.active,
    }
  })

  if (!result) throw new Error('Failed to create success criterion')
  return result
}

// ── Updates ────────────────────────────────────────────────────────────────
// COALESCE keeps the existing value when a field is omitted (null).

export async function updateAssessmentObjective(
  assessmentObjectiveId: string,
  patch: { code?: string | null; title?: string | null },
): Promise<AssessmentObjectiveRecord> {
  let result: AssessmentObjectiveRecord | null = null
  await withDbClient(async (client) => {
    const { rows } = await client.query<AssessmentObjectiveRecord>(
      `update assessment_objectives
         set code = coalesce($2, code), title = coalesce($3, title)
       where assessment_objective_id = $1
       returning assessment_objective_id, curriculum_id, code, title, order_index`,
      [assessmentObjectiveId, patch.code?.trim() ?? null, patch.title?.trim() ?? null],
    )
    if (!rows[0]) throw new Error(`Assessment objective ${assessmentObjectiveId} not found`)
    result = rows[0]
  })
  if (!result) throw new Error('Failed to update assessment objective')
  return result
}

export async function updateLearningObjective(
  learningObjectiveId: string,
  patch: { title?: string | null; specRef?: string | null; active?: boolean | null },
): Promise<LearningObjectiveRecord> {
  let result: LearningObjectiveRecord | null = null
  await withDbClient(async (client) => {
    const { rows } = await client.query<LearningObjectiveRecord>(
      `update learning_objectives
         set title = coalesce($2, title),
             spec_ref = coalesce($3, spec_ref),
             active = coalesce($4, active)
       where learning_objective_id = $1
       returning learning_objective_id, assessment_objective_id, title, spec_ref, active, order_index`,
      [learningObjectiveId, patch.title?.trim() ?? null, patch.specRef?.trim() ?? null, patch.active ?? null],
    )
    if (!rows[0]) throw new Error(`Learning objective ${learningObjectiveId} not found`)
    result = rows[0]
  })
  if (!result) throw new Error('Failed to update learning objective')
  return result
}

export async function updateSuccessCriterion(
  successCriteriaId: string,
  patch: { description?: string | null; level?: number | null; active?: boolean | null },
): Promise<SuccessCriterionRecord> {
  let result: SuccessCriterionRecord | null = null
  await withDbClient(async (client) => {
    const { rows } = await client.query<SuccessCriterionRecord>(
      `update success_criteria
         set description = coalesce($2, description),
             level = coalesce($3, level),
             active = coalesce($4, active)
       where success_criteria_id = $1
       returning success_criteria_id, learning_objective_id, description, level, order_index, active`,
      [successCriteriaId, patch.description?.trim() ?? null, patch.level ?? null, patch.active ?? null],
    )
    if (!rows[0]) throw new Error(`Success criterion ${successCriteriaId} not found`)
    result = rows[0]
  })
  if (!result) throw new Error('Failed to update success criterion')
  return result
}

// ── Soft delete (deactivate) ───────────────────────────────────────────────
// Set active=false rather than hard-delete: pupil work / links reference these
// rows and there are no FK cascades, so deleting would orphan scores.

export async function deactivateLearningObjective(learningObjectiveId: string): Promise<LearningObjectiveRecord> {
  return updateLearningObjective(learningObjectiveId, { active: false })
}

export async function deactivateSuccessCriterion(successCriteriaId: string): Promise<SuccessCriterionRecord> {
  return updateSuccessCriterion(successCriteriaId, { active: false })
}
