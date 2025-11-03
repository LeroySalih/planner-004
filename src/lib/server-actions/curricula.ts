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
import { createSupabaseServerClient } from "@/lib/supabase/server"
import {
  fetchSuccessCriteriaForLearningObjectives,
  type NormalizedSuccessCriterion,
} from "./learning-objectives"

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

export async function readCurriculaAction() {
  console.log("[curricula] readCurriculaAction:start")

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("curricula")
    .select("*")
    .order("title", { ascending: true })

  if (error) {
    console.error("[curricula] readCurriculaAction:error", error)
    return CurriculaReturnValue.parse({ data: null, error: error.message })
  }

  return CurriculaReturnValue.parse({ data, error: null })
}

export async function createCurriculumAction(payload: {
  title: string
  subject?: string | null
  description?: string | null
  active?: boolean
}) {
  console.log("[curricula] createCurriculumAction:start", { payload })

  const supabase = await createSupabaseServerClient()

  const title = (payload.title ?? "").trim()
  if (title.length === 0) {
    return CurriculumReturnValue.parse({ data: null, error: "Curriculum title is required" })
  }

  const subject = payload.subject ? payload.subject.trim() : null
  const description = payload.description ? payload.description.trim() : null
  const active = payload.active ?? true

  const { data, error } = await supabase
    .from("curricula")
    .insert({
      title,
      subject: subject && subject.length > 0 ? subject : null,
      description: description && description.length > 0 ? description : null,
      active,
    })
    .select("curriculum_id, title, subject, description, active")
    .single()

  if (error) {
    console.error("[curricula] createCurriculumAction:error", error)
    return CurriculumReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath("/curriculum")

  return CurriculumReturnValue.parse({ data, error: null })
}

export async function updateCurriculumAction(
  curriculumId: string,
  payload: { title?: string; subject?: string | null; description?: string | null; active?: boolean },
) {
  console.log("[curricula] updateCurriculumAction:start", { curriculumId, payload })

  const supabase = await createSupabaseServerClient()

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
    const { data, error } = await supabase
      .from("curricula")
      .select("curriculum_id, title, subject, description, active")
      .eq("curriculum_id", curriculumId)
      .maybeSingle()

    if (error) {
      console.error("[curricula] updateCurriculumAction:readError", error)
      return CurriculumReturnValue.parse({ data: null, error: error.message })
    }

    return CurriculumReturnValue.parse({ data, error: null })
  }

  const { data, error } = await supabase
    .from("curricula")
    .update(updates)
    .eq("curriculum_id", curriculumId)
    .select("curriculum_id, title, subject, description, active")
    .single()

  if (error) {
    console.error("[curricula] updateCurriculumAction:error", error)
    return CurriculumReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath("/curriculum")

  return CurriculumReturnValue.parse({ data, error: null })
}

export async function readCurriculumDetailAction(curriculumId: string) {
  console.log("[curricula] readCurriculumDetailAction:start", { curriculumId })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("curricula")
    .select(
      `curriculum_id,
        subject,
        title,
        description,
        active,
        assessment_objectives(
          assessment_objective_id,
          curriculum_id,
          unit_id,
          code,
          title,
          order_index,
          learning_objectives(
            learning_objective_id,
            assessment_objective_id,
            title,
            order_index,
            active,
            spec_ref
          )
        )`
    )
    .eq("curriculum_id", curriculumId)
    .maybeSingle()

  if (error) {
    console.error("[curricula] readCurriculumDetailAction:error", error)
    return CurriculumDetailReturnValue.parse({ data: null, error: error.message })
  }

  if (!data) {
    return CurriculumDetailReturnValue.parse({ data: null, error: null })
  }

  const assessmentObjectives = data.assessment_objectives ?? []

  const learningObjectives = assessmentObjectives.flatMap((ao) =>
    (ao.learning_objectives ?? []).map((lo) => lo.learning_objective_id).filter((id): id is string => Boolean(id)),
  )

  let successCriteriaMap = new Map<string, NormalizedSuccessCriterion[]>()

  if (learningObjectives.length > 0) {
    const { map, error: scError } = await fetchSuccessCriteriaForLearningObjectives(
      learningObjectives,
      undefined,
      supabase,
    )
    if (scError) {
      console.error("[curricula] readCurriculumDetailAction:successCriteriaError", scError)
      return CurriculumDetailReturnValue.parse({ data: null, error: scError })
    }
    successCriteriaMap = map
  }

  const normalizedAssessmentObjectives = assessmentObjectives
    .map((ao) => ({
      ...ao,
      order_index: ao.order_index ?? 0,
      learning_objectives: (ao.learning_objectives ?? [])
        .map((lo, index) => ({
          ...lo,
          order_index: lo.order_index ?? index,
          active: lo.active ?? true,
          spec_ref: lo.spec_ref ?? null,
          success_criteria: successCriteriaMap.get(lo.learning_objective_id ?? "") ?? [],
        }))
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    }))
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

  const parsed = CurriculumDetailReturnValue.parse({
    data: {
      curriculum_id: data.curriculum_id,
      subject: data.subject,
      title: data.title,
      description: data.description,
      assessment_objectives: normalizedAssessmentObjectives,
    },
    error: null,
  })

  return parsed
}

export async function readAssessmentObjectivesAction() {
  console.log("[curricula] readAssessmentObjectivesAction:start")

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("assessment_objectives")
    .select("assessment_objective_id, curriculum_id, unit_id, code, title, order_index")
    .order("curriculum_id", { ascending: true, nullsFirst: true })
    .order("order_index", { ascending: true, nullsFirst: true })
    .order("title", { ascending: true })

  if (error) {
    console.error("[curricula] readAssessmentObjectivesAction:error", error)
    return AssessmentObjectiveSummaryListReturnValue.parse({ data: null, error: error.message })
  }

  const normalized = (data ?? []).map((entry) => ({
    ...entry,
    order_index: entry.order_index ?? 0,
  }))

  return AssessmentObjectiveSummaryListReturnValue.parse({ data: normalized, error: null })
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

  const supabase = await createSupabaseServerClient()

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

  const { data, error } = await supabase
    .from("assessment_objectives")
    .insert(sanitized)
    .select("assessment_objective_id, curriculum_id, unit_id, code, title, order_index")
    .single()

  if (error) {
    console.error("[curricula] createCurriculumAssessmentObjectiveAction:error", error)
    return AssessmentObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath("/curriculum")
  revalidatePath(`/curriculum/${curriculumId}`)

  return AssessmentObjectiveReturnValue.parse({ data, error: null })
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

  const supabase = await createSupabaseServerClient()

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

  const { data, error } = await supabase
    .from("assessment_objectives")
    .update(payload)
    .eq("assessment_objective_id", assessmentObjectiveId)
    .select("assessment_objective_id, curriculum_id, unit_id, code, title, order_index")
    .single()

  if (error) {
    console.error("[curricula] updateCurriculumAssessmentObjectiveAction:error", error)
    return AssessmentObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath("/curriculum")
  revalidatePath(`/curriculum/${curriculumId}`)

  return AssessmentObjectiveReturnValue.parse({ data, error: null })
}

export async function deleteCurriculumAssessmentObjectiveAction(
  assessmentObjectiveId: string,
  curriculumId: string,
) {
  console.log("[curricula] deleteCurriculumAssessmentObjectiveAction:start", {
    assessmentObjectiveId,
    curriculumId,
  })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("assessment_objectives")
    .delete()
    .eq("assessment_objective_id", assessmentObjectiveId)

  if (error) {
    console.error("[curricula] deleteCurriculumAssessmentObjectiveAction:error", error)
    return { success: false, error: error.message }
  }

  revalidatePath("/curriculum")
  revalidatePath(`/curriculum/${curriculumId}`)

  return { success: true }
}

export async function reorderCurriculumAssessmentObjectivesAction(
  curriculumId: string,
  orderedAssessmentObjectiveIds: string[],
) {
  console.log("[curricula] reorderCurriculumAssessmentObjectivesAction:start", {
    curriculumId,
    orderedAssessmentObjectiveIds,
  })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("assessment_objectives")
    .upsert(
      orderedAssessmentObjectiveIds.map((assessmentObjectiveId, index) => ({
        assessment_objective_id: assessmentObjectiveId,
        order_index: index,
      })),
      { onConflict: "assessment_objective_id" },
    )

  if (error) {
    console.error("[curricula] reorderCurriculumAssessmentObjectivesAction:error", error)
    return AssessmentObjectiveListReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  const { data, error: readError } = await supabase
    .from("assessment_objectives")
    .select(
      `assessment_objective_id,
        curriculum_id,
        unit_id,
        code,
        title,
        order_index,
        learning_objectives(
          learning_objective_id,
          assessment_objective_id,
          title,
          order_index,
          success_criteria(
            success_criteria_id,
            learning_objective_id,
            level,
            description,
            order_index,
            active,
            success_criteria_units(unit_id)
          )
        )`
    )
    .eq("curriculum_id", curriculumId)
    .order("order_index", { ascending: true })

  if (readError) {
    console.error("[curricula] reorderCurriculumAssessmentObjectivesAction:readError", readError)
    return AssessmentObjectiveListReturnValue.parse({ data: null, error: readError.message })
  }

  const normalized = (data ?? []).map((ao) => ({
    ...ao,
    learning_objectives: (ao.learning_objectives ?? []).map((lo) => ({
      ...lo,
      success_criteria: (lo.success_criteria ?? []).map((criterion) => ({
        success_criteria_id: criterion.success_criteria_id,
        learning_objective_id: criterion.learning_objective_id,
        level: criterion.level ?? 1,
        description: criterion.description ?? "",
        order_index: criterion.order_index ?? 0,
        active: criterion.active ?? true,
        units: (criterion.success_criteria_units ?? []).map((entry) => entry.unit_id),
      })),
    })),
  }))

  return AssessmentObjectiveListReturnValue.parse({ data: normalized, error: null })
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

  const supabase = await createSupabaseServerClient()

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

  const { data, error } = await supabase
    .from("learning_objectives")
    .insert(sanitized)
    .select("learning_objective_id, assessment_objective_id, title, order_index, active, spec_ref")
    .single()

  if (error) {
    console.error("[curricula] createCurriculumLearningObjectiveAction:error", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  return LearningObjectiveReturnValue.parse({ data, error: null })
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

  const supabase = await createSupabaseServerClient()

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

  const { data, error } = await supabase
    .from("learning_objectives")
    .update(payload)
    .eq("learning_objective_id", learningObjectiveId)
    .select("learning_objective_id, assessment_objective_id, title, order_index, active, spec_ref")
    .single()

  if (error) {
    console.error("[curricula] updateCurriculumLearningObjectiveAction:error", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  return LearningObjectiveReturnValue.parse({ data, error: null })
}

export async function deleteCurriculumLearningObjectiveAction(
  learningObjectiveId: string,
  curriculumId: string,
) {
  console.log("[curricula] deleteCurriculumLearningObjectiveAction:start", {
    learningObjectiveId,
    curriculumId,
  })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("learning_objectives")
    .delete()
    .eq("learning_objective_id", learningObjectiveId)

  if (error) {
    console.error("[curricula] deleteCurriculumLearningObjectiveAction:error", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  return { success: true }
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

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("learning_objectives")
    .upsert(
      orderedLearningObjectiveIds.map((learningObjectiveId, index) => ({
        learning_objective_id: learningObjectiveId,
        order_index: index,
      })),
      { onConflict: "learning_objective_id" },
    )

  if (error) {
    console.error("[curricula] reorderCurriculumLearningObjectivesAction:error", error)
    return LearningObjectiveListReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  const { data, error: readError } = await supabase
    .from("learning_objectives")
    .select(
      `learning_objective_id,
        assessment_objective_id,
        title,
        order_index,
        active,
        spec_ref,
        success_criteria(
          success_criteria_id,
          learning_objective_id,
          level,
          description,
          order_index,
          active,
          success_criteria_units(unit_id)
        )`
    )
    .eq("assessment_objective_id", assessmentObjectiveId)
    .order("order_index", { ascending: true })

  if (readError) {
    console.error("[curricula] reorderCurriculumLearningObjectivesAction:readError", readError)
    return LearningObjectiveListReturnValue.parse({ data: null, error: readError.message })
  }

  const normalized = (data ?? []).map((lo) => ({
    ...lo,
    active: lo.active ?? true,
    success_criteria: (lo.success_criteria ?? []).map((criterion) => ({
      success_criteria_id: criterion.success_criteria_id,
      learning_objective_id: criterion.learning_objective_id,
      level: criterion.level ?? 1,
      description: criterion.description ?? "",
      order_index: criterion.order_index ?? 0,
      active: criterion.active ?? true,
      units: (criterion.success_criteria_units ?? []).map((entry) => entry.unit_id),
    })),
  }))

  return LearningObjectiveListReturnValue.parse({ data: normalized, error: null })
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

  const supabase = await createSupabaseServerClient()

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

  const { data, error } = await supabase
    .from("success_criteria")
    .insert(sanitized)
    .select("success_criteria_id, learning_objective_id, level, description, order_index, active")
    .single()

  if (error) {
    console.error("[curricula] createCurriculumSuccessCriterionAction:error", error)
    return SuccessCriterionReturnValue.parse({ data: null, error: error.message })
  }

  if (sanitizedUnits.length > 0) {
    const { error: unitError } = await supabase
      .from("success_criteria_units")
      .insert(
        sanitizedUnits.map((unitId) => ({
          success_criteria_id: data.success_criteria_id,
          unit_id: unitId,
        })),
      )

    if (unitError) {
      console.error("[curricula] createCurriculumSuccessCriterionAction:unitLinkError", unitError)
      return SuccessCriterionReturnValue.parse({ data: null, error: unitError.message })
    }
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  return SuccessCriterionReturnValue.parse({ data: { ...data, units: sanitizedUnits }, error: null })
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

  const supabase = await createSupabaseServerClient()

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

  if (Object.keys(payload).length > 0) {
    const { error } = await supabase
      .from("success_criteria")
      .update(payload)
      .eq("success_criteria_id", successCriterionId)

    if (error) {
      console.error("[curricula] updateCurriculumSuccessCriterionAction:error", error)
      return SuccessCriterionReturnValue.parse({ data: null, error: error.message })
    }
  }

  if (updates.unit_ids) {
    const sanitizedUnits = Array.from(new Set(updates.unit_ids)).filter((unitId) => unitId.trim().length > 0)

    const { data: existingLinks, error: readLinksError } = await supabase
      .from("success_criteria_units")
      .select("unit_id")
      .eq("success_criteria_id", successCriterionId)

    if (readLinksError) {
      console.error("[curricula] updateCurriculumSuccessCriterionAction:readLinksError", readLinksError)
      return SuccessCriterionReturnValue.parse({ data: null, error: readLinksError.message })
    }

    const existingSet = new Set((existingLinks ?? []).map((entry) => entry.unit_id))
    const sanitizedSet = new Set(sanitizedUnits)

    const toInsert = sanitizedUnits.filter((unitId) => !existingSet.has(unitId))
    const toDelete = Array.from(existingSet).filter((unitId) => !sanitizedSet.has(unitId))

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("success_criteria_units")
        .delete()
        .eq("success_criteria_id", successCriterionId)
        .in("unit_id", toDelete)

      if (deleteError) {
        console.error("[curricula] updateCurriculumSuccessCriterionAction:deleteLinksError", deleteError)
        return SuccessCriterionReturnValue.parse({ data: null, error: deleteError.message })
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("success_criteria_units")
        .insert(
          toInsert.map((unitId) => ({
            success_criteria_id: successCriterionId,
            unit_id: unitId,
          })),
        )

      if (insertError) {
        console.error("[curricula] updateCurriculumSuccessCriterionAction:insertLinksError", insertError)
        return SuccessCriterionReturnValue.parse({ data: null, error: insertError.message })
      }
    }
  }

  const { data, error: readError } = await supabase
    .from("success_criteria")
    .select(
      "success_criteria_id, learning_objective_id, level, description, order_index, active, success_criteria_units(unit_id)",
    )
    .eq("success_criteria_id", successCriterionId)
    .maybeSingle()

  if (readError) {
    console.error("[curricula] updateCurriculumSuccessCriterionAction:readError", readError)
    return SuccessCriterionReturnValue.parse({ data: null, error: readError.message })
  }

  if (!data) {
    return SuccessCriterionReturnValue.parse({ data: null, error: null })
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  return SuccessCriterionReturnValue.parse({
    data: {
      success_criteria_id: data.success_criteria_id,
      learning_objective_id: data.learning_objective_id,
      level: data.level ?? 1,
      description: data.description ?? "",
      order_index: data.order_index ?? 0,
      active: data.active ?? true,
      units: (data.success_criteria_units ?? []).map((entry) => entry.unit_id),
    },
    error: null,
  })
}

export async function deleteCurriculumSuccessCriterionAction(
  successCriterionId: string,
  curriculumId: string,
) {
  console.log("[curricula] deleteCurriculumSuccessCriterionAction:start", {
    successCriterionId,
    curriculumId,
  })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("success_criteria")
    .delete()
    .eq("success_criteria_id", successCriterionId)

  if (error) {
    console.error("[curricula] deleteCurriculumSuccessCriterionAction:error", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  return { success: true }
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

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("success_criteria")
    .upsert(
      orderedSuccessCriterionIds.map((successCriterionId, index) => ({
        success_criteria_id: successCriterionId,
        order_index: index,
      })),
      { onConflict: "success_criteria_id" },
    )

  if (error) {
    console.error("[curricula] reorderCurriculumSuccessCriteriaAction:error", error)
    return SuccessCriteriaListReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath(`/curriculum/${curriculumId}`)

  const { data, error: readError } = await supabase
    .from("success_criteria")
    .select("success_criteria_id, learning_objective_id, level, description, order_index, active, success_criteria_units(unit_id)")
    .eq("learning_objective_id", learningObjectiveId)
    .order("order_index", { ascending: true })

  if (readError) {
    console.error("[curricula] reorderCurriculumSuccessCriteriaAction:readError", readError)
    return SuccessCriteriaListReturnValue.parse({ data: null, error: readError.message })
  }

  const normalized = (data ?? []).map((criterion) => ({
    success_criteria_id: criterion.success_criteria_id,
    learning_objective_id: criterion.learning_objective_id,
    level: criterion.level ?? 1,
    description: criterion.description ?? "",
    order_index: criterion.order_index ?? 0,
    active: criterion.active ?? true,
    units: (criterion.success_criteria_units ?? []).map((entry) => entry.unit_id),
  }))

  return SuccessCriteriaListReturnValue.parse({ data: normalized, error: null })
}
