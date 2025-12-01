"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  CurriculumDetailSchema,
  CurriculaSchema,
  AssessmentObjectiveSchema,
  AssessmentObjectivesSchema,
  AssessmentObjectiveDetailSchema,
  LearningObjectiveSchema,
  LearningObjectiveWithCriteriaSchema,
  SuccessCriterionSchema,
  SuccessCriteriaSchema,
  CurriculumSchema,
} from "@/types"
import { query, withDbClient } from "@/lib/db"
import {
  fetchSuccessCriteriaForLearningObjectives,
  type NormalizedSuccessCriterion,
} from "./learning-objectives"
import { withTelemetry } from "@/lib/telemetry"

const CurriculaReturnValue = z.object({
  data: CurriculaSchema.nullable(),
  error: z.string().nullable(),
})

const CurriculumDetailReturnValue = z.object({
  data: CurriculumDetailSchema.nullable(),
  error: z.string().nullable(),
})

const CurriculumReturnValue = z.object({
  data: CurriculumSchema.nullable(),
  error: z.string().nullable(),
})

const AssessmentObjectiveReturnValue = z.object({
  data: AssessmentObjectiveSchema.nullable(),
  error: z.string().nullable(),
})

const AssessmentObjectiveListReturnValue = z.object({
  data: z.array(AssessmentObjectiveDetailSchema).nullable(),
  error: z.string().nullable(),
})

const LearningObjectiveReturnValue = z.object({
  data: LearningObjectiveSchema.nullable(),
  error: z.string().nullable(),
})

const LearningObjectiveListReturnValue = z.object({
  data: z.array(LearningObjectiveWithCriteriaSchema).nullable(),
  error: z.string().nullable(),
})

const SuccessCriterionReturnValue = z.object({
  data: SuccessCriterionSchema.nullable(),
  error: z.string().nullable(),
})

const SuccessCriteriaListReturnValue = z.object({
  data: SuccessCriteriaSchema.nullable(),
  error: z.string().nullable(),
})

const AssessmentObjectiveSummaryListReturnValue = z.object({
  data: AssessmentObjectivesSchema.nullable(),
  error: z.string().nullable(),
})

export async function readCurriculaAction(options?: { authEndTime?: number | null; routeTag?: string }) {
  const routeTag = options?.routeTag ?? "/curricula:readCurricula"

  return withTelemetry(
    {
      routeTag,
      functionName: "readCurriculaAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[curricula] readCurriculaAction:start")

      try {
        const { rows } = await query<{
          curriculum_id: string
          title: string | null
          subject: string | null
          description: string | null
          active: boolean | null
        }>(
          `
            select curriculum_id, title, subject, description, active
            from curricula
            order by title asc
          `,
        )

        return CurriculaReturnValue.parse({ data: rows ?? [], error: null })
      } catch (error) {
        console.error("[curricula] readCurriculaAction:error", error)
        const message = error instanceof Error ? error.message : "Unable to load curricula."
        return CurriculaReturnValue.parse({ data: null, error: message })
      }
    },
  )
}

export async function createCurriculumAction(payload: {
  title: string
  subject?: string | null
  description?: string | null
  active?: boolean
}) {
  console.log("[curricula] createCurriculumAction:start", { payload })

  const title = (payload.title ?? "").trim()
  if (title.length === 0) {
    return CurriculumReturnValue.parse({ data: null, error: "Curriculum title is required" })
  }

  const subject = payload.subject ? payload.subject.trim() : null
  const description = payload.description ? payload.description.trim() : null
  const active = payload.active ?? true

  try {
    const { rows } = await query<{
      curriculum_id: string
      title: string | null
      subject: string | null
      description: string | null
      active: boolean | null
    }>(
      `
        insert into curricula (title, subject, description, active)
        values ($1, $2, $3, $4)
        returning curriculum_id, title, subject, description, active
      `,
      [title, subject && subject.length > 0 ? subject : null, description && description.length > 0 ? description : null, active],
    )

    const data = rows[0] ?? null
    if (!data) {
      return CurriculumReturnValue.parse({ data: null, error: "Unable to create curriculum." })
    }

    revalidatePath("/curriculum")

    return CurriculumReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[curricula] createCurriculumAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to create curriculum."
    return CurriculumReturnValue.parse({ data: null, error: message })
  }
}

export async function updateCurriculumAction(
  curriculumId: string,
  payload: { title?: string; subject?: string | null; description?: string | null; active?: boolean },
) {
  console.log("[curricula] updateCurriculumAction:start", { curriculumId, payload })

  const updates: Record<string, unknown> = {}

  if (payload.title !== undefined) {
    const trimmed = payload.title.trim()
    if (trimmed.length === 0) {
      return CurriculumReturnValue.parse({ data: null, error: "Curriculum title is required" })
    }
    updates.title = trimmed
  }

  if (payload.subject !== undefined) {
    const subjectValue = payload.subject ? payload.subject.trim() : null
    updates.subject = subjectValue && subjectValue.length > 0 ? subjectValue : null
  }

  if (payload.description !== undefined) {
    const descriptionValue = payload.description ? payload.description.trim() : null
    updates.description = descriptionValue && descriptionValue.length > 0 ? descriptionValue : null
  }

  if (payload.active !== undefined) {
    updates.active = payload.active
  }

  if (Object.keys(updates).length === 0) {
    console.log("[curricula] updateCurriculumAction:no-op", { curriculumId })
    try {
      const { rows } = await query<{
        curriculum_id: string
        title: string | null
        subject: string | null
        description: string | null
        active: boolean | null
      }>(
        `
          select curriculum_id, title, subject, description, active
          from curricula
          where curriculum_id = $1
          limit 1
        `,
        [curriculumId],
      )
      const data = rows[0] ?? null
      return CurriculumReturnValue.parse({ data, error: null })
    } catch (error) {
      console.error("[curricula] updateCurriculumAction:readError", error)
      const message = error instanceof Error ? error.message : "Unable to load curriculum."
      return CurriculumReturnValue.parse({ data: null, error: message })
    }
  }

  const setFragments: string[] = []
  const values: unknown[] = []
  let idx = 1
  for (const [key, value] of Object.entries(updates)) {
    setFragments.push(`${key} = $${idx++}`)
    values.push(value)
  }
  values.push(curriculumId)

  try {
    const { rows } = await query<{
      curriculum_id: string
      title: string | null
      subject: string | null
      description: string | null
      active: boolean | null
    }>(
      `
        update curricula
        set ${setFragments.join(", ")}
        where curriculum_id = $${idx}
        returning curriculum_id, title, subject, description, active
      `,
      values,
    )

    const data = rows[0] ?? null
    revalidatePath("/curriculum")
    return CurriculumReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[curricula] updateCurriculumAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to update curriculum."
    return CurriculumReturnValue.parse({ data: null, error: message })
  }
}

export async function readCurriculumDetailAction(curriculumId: string) {
  console.log("[curricula] readCurriculumDetailAction:start", { curriculumId })

  try {
    const { rows: curriculumRows } = await query<{
      curriculum_id: string
      subject: string | null
      title: string | null
      description: string | null
      active: boolean | null
    }>("select curriculum_id, subject, title, description, active from curricula where curriculum_id = $1", [curriculumId])

    const curriculum = curriculumRows[0]
    if (!curriculum) {
      return CurriculumDetailReturnValue.parse({ data: null, error: null })
    }

    const { rows: aoRows } = await query<{
      assessment_objective_id: string
      curriculum_id: string | null
      unit_id: string | null
      code: string | null
      title: string | null
      order_index: number | null
    }>(
      `
        select assessment_objective_id, curriculum_id, unit_id, code, title, order_index
        from assessment_objectives
        where curriculum_id = $1
        order by order_index asc nulls first, title asc
      `,
      [curriculumId],
    )

    const aoIds = aoRows.map((ao) => ao.assessment_objective_id)
    const { rows: loRows } = aoIds.length
      ? await query<{
          learning_objective_id: string
          assessment_objective_id: string
          title: string | null
          order_index: number | null
          active: boolean | null
          spec_ref: string | null
        }>(
          `
            select learning_objective_id,
                   assessment_objective_id,
                   title,
                   order_index,
                   active,
                   spec_ref
            from learning_objectives
            where assessment_objective_id = any($1::text[])
            order by order_index asc nulls first, title asc
          `,
          [aoIds],
        )
      : { rows: [] }

    const loIds = loRows.map((lo) => lo.learning_objective_id)
    const { map: successCriteriaMap, error: scError } =
      loIds.length > 0 ? await fetchSuccessCriteriaForLearningObjectives(loIds) : { map: new Map(), error: null }
    if (scError) {
      console.error("[curricula] readCurriculumDetailAction:successCriteriaError", scError)
      return CurriculumDetailReturnValue.parse({ data: null, error: scError })
    }

    const loByAo = new Map<string, typeof loRows>()
    for (const lo of loRows) {
      const list = loByAo.get(lo.assessment_objective_id) ?? []
      list.push(lo)
      loByAo.set(lo.assessment_objective_id, list)
    }

    const normalizedAssessmentObjectives = aoRows
      .map((ao, index) => ({
        ...ao,
        order_index: ao.order_index ?? index,
        learning_objectives: (loByAo.get(ao.assessment_objective_id) ?? [])
          .map((lo, loIndex) => ({
            ...lo,
            order_index: lo.order_index ?? loIndex,
            active: lo.active ?? true,
            spec_ref: lo.spec_ref ?? null,
            success_criteria: successCriteriaMap.get(lo.learning_objective_id ?? "") ?? [],
          }))
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
      }))
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

    const parsed = CurriculumDetailReturnValue.parse({
      data: {
        curriculum_id: curriculum.curriculum_id,
        subject: curriculum.subject,
        title: curriculum.title,
        description: curriculum.description,
        assessment_objectives: normalizedAssessmentObjectives,
      },
      error: null,
    })

    return parsed
  } catch (error) {
    console.error("[curricula] readCurriculumDetailAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to load curriculum."
    return CurriculumDetailReturnValue.parse({ data: null, error: message })
  }
}

export async function readAssessmentObjectivesAction(
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/curricula:assessmentObjectives"

  return withTelemetry(
    {
      routeTag,
      functionName: "readAssessmentObjectivesAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[curricula] readAssessmentObjectivesAction:start")

      try {
        const { rows } = await query<{
          assessment_objective_id: string
          curriculum_id: string | null
          unit_id: string | null
          code: string | null
          title: string | null
          order_index: number | null
        }>(
          `
            select assessment_objective_id, curriculum_id, unit_id, code, title, order_index
            from assessment_objectives
            order by curriculum_id asc nulls first, order_index asc nulls first, title asc
          `,
        )

        const normalized = (rows ?? []).map((entry) => ({
          ...entry,
          order_index: entry.order_index ?? 0,
        }))

        return AssessmentObjectiveSummaryListReturnValue.parse({ data: normalized, error: null })
      } catch (error) {
        console.error("[curricula] readAssessmentObjectivesAction:error", error)
        const message = error instanceof Error ? error.message : "Unable to load assessment objectives."
        return AssessmentObjectiveSummaryListReturnValue.parse({ data: null, error: message })
      }
    },
  )
}

export async function createCurriculumAssessmentObjectiveAction(
  curriculumId: string,
  payload: {
    code: string
    title: string
    unit_id?: string | null
    order_index?: number
  },
) {
  console.log("[curricula] createCurriculumAssessmentObjectiveAction:start", { curriculumId, payload })

  const sanitized = {
    curriculum_id: curriculumId,
    code: payload.code.trim(),
    title: payload.title.trim(),
    unit_id: payload.unit_id ?? null,
    order_index: payload.order_index ?? 0,
  }

  if (sanitized.code.length === 0) {
    return AssessmentObjectiveReturnValue.parse({ data: null, error: "Assessment objective code is required" })
  }

  if (sanitized.title.length === 0) {
    return AssessmentObjectiveReturnValue.parse({ data: null, error: "Assessment objective title is required" })
  }

  try {
    const { rows } = await query<{
      assessment_objective_id: string
      curriculum_id: string | null
      unit_id: string | null
      code: string | null
      title: string | null
      order_index: number | null
    }>(
      `
        insert into assessment_objectives (curriculum_id, code, title, unit_id, order_index)
        values ($1, $2, $3, $4, $5)
        returning assessment_objective_id, curriculum_id, unit_id, code, title, order_index
      `,
      [sanitized.curriculum_id, sanitized.code, sanitized.title, sanitized.unit_id, sanitized.order_index],
    )

    const data = rows[0] ?? null

    if (!data) {
      return AssessmentObjectiveReturnValue.parse({ data: null, error: "Unable to create assessment objective" })
    }

    revalidatePath("/curriculum")
    revalidatePath(`/curriculum/${curriculumId}`)

    return AssessmentObjectiveReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[curricula] createCurriculumAssessmentObjectiveAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to create assessment objective."
    return AssessmentObjectiveReturnValue.parse({ data: null, error: message })
  }
}

export async function updateCurriculumAssessmentObjectiveAction(
  assessmentObjectiveId: string,
  curriculumId: string,
  updates: {
    code?: string
    title?: string
    unit_id?: string | null
    order_index?: number
  },
) {
  console.log("[curricula] updateCurriculumAssessmentObjectiveAction:start", {
    assessmentObjectiveId,
    curriculumId,
    updates,
  })

  const payload: Record<string, unknown> = {}
  if (typeof updates.code === "string") {
    const trimmed = updates.code.trim()
    if (trimmed.length === 0) {
      return AssessmentObjectiveReturnValue.parse({ data: null, error: "Assessment objective code is required" })
    }
    payload.code = trimmed
  }
  if (typeof updates.title === "string") {
    const trimmed = updates.title.trim()
    if (trimmed.length === 0) {
      return AssessmentObjectiveReturnValue.parse({ data: null, error: "Assessment objective title is required" })
    }
    payload.title = trimmed
  }
  if (Object.prototype.hasOwnProperty.call(updates, "unit_id")) {
    payload.unit_id = updates.unit_id ?? null
  }
  if (typeof updates.order_index === "number") {
    payload.order_index = updates.order_index
  }

  if (Object.keys(payload).length === 0) {
    return AssessmentObjectiveReturnValue.parse({ data: null, error: "No updates provided." })
  }

  const setFragments: string[] = []
  const values: unknown[] = []
  let idx = 1
  for (const [key, value] of Object.entries(payload)) {
    setFragments.push(`${key} = $${idx++}`)
    values.push(value)
  }
  values.push(assessmentObjectiveId)

  try {
    const { rows } = await query<{
      assessment_objective_id: string
      curriculum_id: string | null
      unit_id: string | null
      code: string | null
      title: string | null
      order_index: number | null
    }>(
      `
        update assessment_objectives
        set ${setFragments.join(", ")}
        where assessment_objective_id = $${idx}
        returning assessment_objective_id, curriculum_id, unit_id, code, title, order_index
      `,
      values,
    )

    const data = rows[0] ?? null

    revalidatePath("/curriculum")
    revalidatePath(`/curriculum/${curriculumId}`)

    return AssessmentObjectiveReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[curricula] updateCurriculumAssessmentObjectiveAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to update assessment objective."
    return AssessmentObjectiveReturnValue.parse({ data: null, error: message })
  }
}

export async function deleteCurriculumAssessmentObjectiveAction(
  assessmentObjectiveId: string,
  curriculumId: string,
) {
  console.log("[curricula] deleteCurriculumAssessmentObjectiveAction:start", {
    assessmentObjectiveId,
    curriculumId,
  })

  try {
    const { rowCount } = await query(
      "delete from assessment_objectives where assessment_objective_id = $1",
      [assessmentObjectiveId],
    )

    if (rowCount === 0) {
      return { success: false, error: "Assessment objective not found." }
    }

    revalidatePath("/curriculum")
    revalidatePath(`/curriculum/${curriculumId}`)

    return { success: true }
  } catch (error) {
    console.error("[curricula] deleteCurriculumAssessmentObjectiveAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to delete assessment objective."
    return { success: false, error: message }
  }
}

export async function reorderCurriculumAssessmentObjectivesAction(
  curriculumId: string,
  orderedAssessmentObjectiveIds: string[],
) {
  console.log("[curricula] reorderCurriculumAssessmentObjectivesAction:start", {
    curriculumId,
    orderedAssessmentObjectiveIds,
  })

  const orderIndexes = orderedAssessmentObjectiveIds.map((_, index) => index)

  try {
    await query(
      `
        update assessment_objectives as ao
        set order_index = ordered.order_index
        from unnest($1::text[], $2::int[]) as ordered(assessment_objective_id, order_index)
        where ao.assessment_objective_id = ordered.assessment_objective_id
      `,
      [orderedAssessmentObjectiveIds, orderIndexes],
    )

    revalidatePath(`/curriculum/${curriculumId}`)

    const { rows } = await query<{
      assessment_objective_id: string
      curriculum_id: string | null
      unit_id: string | null
      code: string | null
      title: string | null
      order_index: number | null
    }>(
      `
        select assessment_objective_id, curriculum_id, unit_id, code, title, order_index
        from assessment_objectives
        where curriculum_id = $1
        order by order_index asc nulls first
      `,
      [curriculumId],
    )

    const aoIds = rows.map((ao) => ao.assessment_objective_id)
    const { rows: loRows } = aoIds.length
      ? await query<{
          learning_objective_id: string
          assessment_objective_id: string
          title: string | null
          order_index: number | null
          active: boolean | null
          spec_ref: string | null
        }>(
          `
            select learning_objective_id,
                   assessment_objective_id,
                   title,
                   order_index,
                   active,
                   spec_ref
            from learning_objectives
            where assessment_objective_id = any($1::text[])
            order by order_index asc nulls first, title asc
          `,
          [aoIds],
        )
      : { rows: [] }

    const loIds = loRows.map((lo) => lo.learning_objective_id)
    const { map: scMap, error: scError } =
      loIds.length > 0 ? await fetchSuccessCriteriaForLearningObjectives(loIds) : { map: new Map(), error: null }
    if (scError) {
      return AssessmentObjectiveListReturnValue.parse({ data: null, error: scError })
    }

    const loByAo = new Map<string, typeof loRows>()
    loRows.forEach((lo) => {
      const bucket = loByAo.get(lo.assessment_objective_id) ?? []
      bucket.push(lo)
      loByAo.set(lo.assessment_objective_id, bucket)
    })

    const normalized = rows.map((ao, index) => ({
      ...ao,
      order_index: ao.order_index ?? index,
      learning_objectives: (loByAo.get(ao.assessment_objective_id) ?? []).map((lo, loIndex) => ({
        ...lo,
        order_index: lo.order_index ?? loIndex,
        success_criteria: scMap.get(lo.learning_objective_id) ?? [],
      })),
    }))

    return AssessmentObjectiveListReturnValue.parse({ data: normalized, error: null })
  } catch (error) {
    console.error("[curricula] reorderCurriculumAssessmentObjectivesAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to reorder assessment objectives."
    return AssessmentObjectiveListReturnValue.parse({ data: null, error: message })
  }
}

export async function createCurriculumLearningObjectiveAction(
  assessmentObjectiveId: string,
  payload: { title: string; order_index?: number; spec_ref?: string | null },
  curriculumId: string,
) {
  console.log("[curricula] createCurriculumLearningObjectiveAction:start", {
    assessmentObjectiveId,
    curriculumId,
    payload,
  })

  const sanitized = {
    assessment_objective_id: assessmentObjectiveId,
    title: payload.title.trim(),
    order_index: payload.order_index ?? 0,
    active: true,
    spec_ref: payload.spec_ref?.trim() ? payload.spec_ref.trim() : null,
  }

  if (sanitized.title.length === 0) {
    return LearningObjectiveReturnValue.parse({ data: null, error: "Learning objective title is required" })
  }

  try {
    const { rows } = await query<{
      learning_objective_id: string
      assessment_objective_id: string
      title: string | null
      order_index: number | null
      active: boolean | null
      spec_ref: string | null
    }>(
      `
        insert into learning_objectives (assessment_objective_id, title, order_index, active, spec_ref)
        values ($1, $2, $3, $4, $5)
        returning learning_objective_id, assessment_objective_id, title, order_index, active, spec_ref
      `,
      [
        sanitized.assessment_objective_id,
        sanitized.title,
        sanitized.order_index,
        sanitized.active,
        sanitized.spec_ref,
      ],
    )

    const data = rows[0] ?? null

    revalidatePath(`/curriculum/${curriculumId}`)

    return LearningObjectiveReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[curricula] createCurriculumLearningObjectiveAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to create learning objective."
    return LearningObjectiveReturnValue.parse({ data: null, error: message })
  }

}

export async function updateCurriculumLearningObjectiveAction(
  learningObjectiveId: string,
  curriculumId: string,
  updates: { title?: string; order_index?: number; active?: boolean; spec_ref?: string | null },
) {
  console.log("[curricula] updateCurriculumLearningObjectiveAction:start", {
    learningObjectiveId,
    curriculumId,
    updates,
  })

  const payload: Record<string, unknown> = {}
  if (typeof updates.title === "string") {
    const trimmed = updates.title.trim()
    if (trimmed.length === 0) {
      return LearningObjectiveReturnValue.parse({ data: null, error: "Learning objective title is required" })
    }
    payload.title = trimmed
  }
  if (typeof updates.order_index === "number") {
    payload.order_index = updates.order_index
  }
  if (typeof updates.active === "boolean") {
    payload.active = updates.active
  }
  if (typeof updates.spec_ref === "string") {
    const trimmed = updates.spec_ref.trim()
    payload.spec_ref = trimmed.length === 0 ? null : trimmed
  } else if (updates.spec_ref === null) {
    payload.spec_ref = null
  }

  if (Object.keys(payload).length === 0) {
    return LearningObjectiveReturnValue.parse({ data: null, error: "No updates provided." })
  }

  const setFragments: string[] = []
  const values: unknown[] = []
  let idx = 1
  for (const [key, value] of Object.entries(payload)) {
    setFragments.push(`${key} = $${idx++}`)
    values.push(value)
  }
  values.push(learningObjectiveId)

  try {
    const { rows } = await query<{
      learning_objective_id: string
      assessment_objective_id: string
      title: string | null
      order_index: number | null
      active: boolean | null
      spec_ref: string | null
    }>(
      `
        update learning_objectives
        set ${setFragments.join(", ")}
        where learning_objective_id = $${idx}
        returning learning_objective_id, assessment_objective_id, title, order_index, active, spec_ref
      `,
      values,
    )

    const data = rows[0] ?? null

    revalidatePath(`/curriculum/${curriculumId}`)

    return LearningObjectiveReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[curricula] updateCurriculumLearningObjectiveAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to update learning objective."
    return LearningObjectiveReturnValue.parse({ data: null, error: message })
  }
}

export async function deleteCurriculumLearningObjectiveAction(
  learningObjectiveId: string,
  curriculumId: string,
) {
  console.log("[curricula] deleteCurriculumLearningObjectiveAction:start", {
    learningObjectiveId,
    curriculumId,
  })

  try {
    const { rowCount } = await query("delete from learning_objectives where learning_objective_id = $1", [
      learningObjectiveId,
    ])

    if (rowCount === 0) {
      return { success: false, error: "Learning objective not found." }
    }

    revalidatePath(`/curriculum/${curriculumId}`)

    return { success: true }
  } catch (error) {
    console.error("[curricula] deleteCurriculumLearningObjectiveAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to delete learning objective."
    return { success: false, error: message }
  }
}

export async function reorderCurriculumLearningObjectivesAction(
  assessmentObjectiveId: string,
  curriculumId: string,
  orderedLearningObjectiveIds: string[],
) {
  console.log("[curricula] reorderCurriculumLearningObjectivesAction:start", {
    assessmentObjectiveId,
    curriculumId,
    orderedLearningObjectiveIds,
  })

  const orderIndexes = orderedLearningObjectiveIds.map((_, index) => index)

  try {
    await query(
      `
        update learning_objectives as lo
        set order_index = ordered.order_index
        from unnest($1::text[], $2::int[]) as ordered(learning_objective_id, order_index)
        where lo.learning_objective_id = ordered.learning_objective_id
      `,
      [orderedLearningObjectiveIds, orderIndexes],
    )

    revalidatePath(`/curriculum/${curriculumId}`)

    const { rows } = await query<{
      learning_objective_id: string
      assessment_objective_id: string
      title: string | null
      order_index: number | null
      active: boolean | null
      spec_ref: string | null
    }>(
      `
        select learning_objective_id,
               assessment_objective_id,
               title,
               order_index,
               active,
               spec_ref
        from learning_objectives
        where assessment_objective_id = $1
        order by order_index asc nulls first
      `,
      [assessmentObjectiveId],
    )

    const loIds = rows.map((lo) => lo.learning_objective_id)
    const { map: scMap, error: scError } =
      loIds.length > 0 ? await fetchSuccessCriteriaForLearningObjectives(loIds) : { map: new Map(), error: null }
    if (scError) {
      return LearningObjectiveListReturnValue.parse({ data: null, error: scError })
    }

    const normalized = rows.map((lo, index) => ({
      ...lo,
      active: lo.active ?? true,
      order_index: lo.order_index ?? index,
      success_criteria: scMap.get(lo.learning_objective_id) ?? [],
    }))

    return LearningObjectiveListReturnValue.parse({ data: normalized, error: null })
  } catch (error) {
    console.error("[curricula] reorderCurriculumLearningObjectivesAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to reorder learning objectives."
    return LearningObjectiveListReturnValue.parse({ data: null, error: message })
  }
}

export async function createCurriculumSuccessCriterionAction(
  learningObjectiveId: string,
  curriculumId: string,
  payload: {
    description: string
    level?: number
    order_index?: number
    active?: boolean
    unit_ids?: string[]
  },
) {
  console.log("[curricula] createCurriculumSuccessCriterionAction:start", {
    learningObjectiveId,
    curriculumId,
    payload,
  })

  const sanitizedUnits = Array.from(new Set(payload.unit_ids ?? [])).filter((unitId) => unitId.trim().length > 0)

  const sanitized = {
    learning_objective_id: learningObjectiveId,
    description: payload.description.trim(),
    level: payload.level ?? 1,
    order_index: payload.order_index ?? 0,
    active: payload.active ?? true,
  }

  if (sanitized.description.length === 0) {
    return SuccessCriterionReturnValue.parse({ data: null, error: "Success criterion description is required" })
  }

  try {
    const { rows } = await query<{
      success_criteria_id: string
      learning_objective_id: string
      level: number | null
      description: string | null
      order_index: number | null
      active: boolean | null
    }>(
      `
        insert into success_criteria (learning_objective_id, level, description, order_index, active)
        values ($1, $2, $3, $4, $5)
        returning success_criteria_id, learning_objective_id, level, description, order_index, active
      `,
      [sanitized.learning_objective_id, sanitized.level, sanitized.description, sanitized.order_index, sanitized.active],
    )

    const data = rows[0] ?? null
    if (!data) {
      return SuccessCriterionReturnValue.parse({ data: null, error: "Unable to create success criterion." })
    }

    if (sanitizedUnits.length > 0) {
      await query(
        `
          insert into success_criteria_units (success_criteria_id, unit_id)
          select $1, unnest($2::text[])
        `,
        [data.success_criteria_id, sanitizedUnits],
      )
    }

    revalidatePath(`/curriculum/${curriculumId}`)

    return SuccessCriterionReturnValue.parse({ data: { ...data, units: sanitizedUnits }, error: null })
  } catch (error) {
    console.error("[curricula] createCurriculumSuccessCriterionAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to create success criterion."
    return SuccessCriterionReturnValue.parse({ data: null, error: message })
  }
}

export async function updateCurriculumSuccessCriterionAction(
  successCriterionId: string,
  curriculumId: string,
  updates: {
    description?: string
    level?: number
    order_index?: number
    active?: boolean
    unit_ids?: string[]
  },
) {
  console.log("[curricula] updateCurriculumSuccessCriterionAction:start", {
    successCriterionId,
    curriculumId,
    updates,
  })

  const payload: Record<string, unknown> = {}
  if (typeof updates.description === "string") {
    const trimmed = updates.description.trim()
    if (trimmed.length === 0) {
      return SuccessCriterionReturnValue.parse({ data: null, error: "Success criterion description is required" })
    }
    payload.description = trimmed
  }
  if (typeof updates.level === "number") {
    payload.level = updates.level
  }
  if (typeof updates.order_index === "number") {
    payload.order_index = updates.order_index
  }
  if (typeof updates.active === "boolean") {
    payload.active = updates.active
  }

  try {
    if (Object.keys(payload).length > 0) {
      const setFragments: string[] = []
      const values: unknown[] = []
      let idx = 1
      for (const [key, value] of Object.entries(payload)) {
        setFragments.push(`${key} = $${idx++}`)
        values.push(value)
      }
      values.push(successCriterionId)

      await query(
        `
          update success_criteria
          set ${setFragments.join(", ")}
          where success_criteria_id = $${idx}
        `,
        values,
      )
    }

    if (updates.unit_ids) {
      const sanitizedUnits = Array.from(new Set(updates.unit_ids)).filter((unitId) => unitId.trim().length > 0)

      const { rows: existingLinks } = await query<{ unit_id: string }>(
        "select unit_id from success_criteria_units where success_criteria_id = $1",
        [successCriterionId],
      )

      const existingSet = new Set((existingLinks ?? []).map((entry) => entry.unit_id))
      const sanitizedSet = new Set(sanitizedUnits)

      const toInsert = sanitizedUnits.filter((unitId) => !existingSet.has(unitId))
      const toDelete = Array.from(existingSet).filter((unitId) => !sanitizedSet.has(unitId))

      if (toDelete.length > 0) {
        await query(
          `
            delete from success_criteria_units
            where success_criteria_id = $1
              and unit_id = any($2::text[])
          `,
          [successCriterionId, toDelete],
        )
      }

      if (toInsert.length > 0) {
        await query(
          `
            insert into success_criteria_units (success_criteria_id, unit_id)
            select $1, unnest($2::text[])
          `,
          [successCriterionId, toInsert],
        )
      }
    }

    const { rows } = await query<{
      success_criteria_id: string
      learning_objective_id: string
      level: number | null
      description: string | null
      order_index: number | null
      active: boolean | null
    }>(
      `
        select success_criteria_id, learning_objective_id, level, description, order_index, active
        from success_criteria
        where success_criteria_id = $1
        limit 1
      `,
      [successCriterionId],
    )

    const data = rows[0] ?? null
    if (!data) {
      return SuccessCriterionReturnValue.parse({ data: null, error: null })
    }

    const { rows: linkRows } = await query<{ unit_id: string }>(
      "select unit_id from success_criteria_units where success_criteria_id = $1",
      [successCriterionId],
    )

    revalidatePath(`/curriculum/${curriculumId}`)

    return SuccessCriterionReturnValue.parse({
      data: {
        success_criteria_id: data.success_criteria_id,
        learning_objective_id: data.learning_objective_id,
        level: data.level ?? 1,
        description: data.description ?? "",
        order_index: data.order_index ?? 0,
        active: data.active ?? true,
        units: (linkRows ?? []).map((entry) => entry.unit_id),
      },
      error: null,
    })
  } catch (error) {
    console.error("[curricula] updateCurriculumSuccessCriterionAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to update success criterion."
    return SuccessCriterionReturnValue.parse({ data: null, error: message })
  }
}

export async function deleteCurriculumSuccessCriterionAction(
  successCriterionId: string,
  curriculumId: string,
) {
  console.log("[curricula] deleteCurriculumSuccessCriterionAction:start", {
    successCriterionId,
    curriculumId,
  })

  try {
    const { rowCount } = await query("delete from success_criteria where success_criteria_id = $1", [
      successCriterionId,
    ])

    if (rowCount === 0) {
      return { success: false, error: "Success criterion not found." }
    }

    revalidatePath(`/curriculum/${curriculumId}`)

    return { success: true }
  } catch (error) {
    console.error("[curricula] deleteCurriculumSuccessCriterionAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to delete success criterion."
    return { success: false, error: message }
  }
}

export async function reorderCurriculumSuccessCriteriaAction(
  learningObjectiveId: string,
  curriculumId: string,
  orderedSuccessCriterionIds: string[],
) {
  console.log("[curricula] reorderCurriculumSuccessCriteriaAction:start", {
    learningObjectiveId,
    curriculumId,
    orderedSuccessCriterionIds,
  })

  const orderIndexes = orderedSuccessCriterionIds.map((_, index) => index)

  try {
    await query(
      `
        update success_criteria as sc
        set order_index = ordered.order_index
        from unnest($1::text[], $2::int[]) as ordered(success_criteria_id, order_index)
        where sc.success_criteria_id = ordered.success_criteria_id
      `,
      [orderedSuccessCriterionIds, orderIndexes],
    )

    revalidatePath(`/curriculum/${curriculumId}`)

    const { rows } = await query<{
      success_criteria_id: string
      learning_objective_id: string
      level: number | null
      description: string | null
      order_index: number | null
      active: boolean | null
    }>(
      `
        select success_criteria_id, learning_objective_id, level, description, order_index, active
        from success_criteria
        where learning_objective_id = $1
        order by order_index asc nulls first
      `,
      [learningObjectiveId],
    )

    const criterionIds = rows.map((row) => row.success_criteria_id)
    const { rows: unitRows } = criterionIds.length
      ? await query<{ success_criteria_id: string; unit_id: string }>(
          `
            select success_criteria_id, unit_id
            from success_criteria_units
            where success_criteria_id = any($1::text[])
          `,
          [criterionIds],
        )
      : { rows: [] }

    const unitsByCriterion = new Map<string, string[]>(
      Array.from(
        unitRows?.reduce((acc, row) => {
          const units = acc.get(row.success_criteria_id) ?? []
          units.push(row.unit_id)
          acc.set(row.success_criteria_id, units)
          return acc
        }, new Map<string, string[]>()),
      ),
    )

    const normalized = (rows ?? []).map((criterion, index) => ({
      success_criteria_id: criterion.success_criteria_id,
      learning_objective_id: criterion.learning_objective_id,
      level: criterion.level ?? 1,
      description: criterion.description ?? "",
      order_index: criterion.order_index ?? index,
      active: criterion.active ?? true,
      units: unitsByCriterion.get(criterion.success_criteria_id) ?? [],
    }))

    return SuccessCriteriaListReturnValue.parse({ data: normalized, error: null })
  } catch (error) {
    console.error("[curricula] reorderCurriculumSuccessCriteriaAction:error", error)
    const message = error instanceof Error ? error.message : "Unable to reorder success criteria."
    return SuccessCriteriaListReturnValue.parse({ data: null, error: message })
  }
}
