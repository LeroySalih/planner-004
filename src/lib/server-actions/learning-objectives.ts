"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { LearningObjectiveSchema, SuccessCriteriaSchema } from "@/types"
import { supabaseServer } from "@/lib/supabaseClient"

const LearningObjectiveWithCriteriaSchema = LearningObjectiveSchema.extend({
  success_criteria: SuccessCriteriaSchema.default([]),
})

const LearningObjectivesWithCriteriaSchema = z.array(LearningObjectiveWithCriteriaSchema)

const LearningObjectivesReturnValue = z.object({
  data: LearningObjectivesWithCriteriaSchema.nullable(),
  error: z.string().nullable(),
})

const LearningObjectiveReturnValue = z.object({
  data: LearningObjectiveWithCriteriaSchema.nullable(),
  error: z.string().nullable(),
})

const SuccessCriteriaInputSchema = z
  .array(
    z.object({
      success_criteria_id: z.string().optional(),
      title: z.string().trim().min(1, "Title is required"),
    }),
  )
  .max(3)

export type LearningObjectiveWithCriteria = z.infer<typeof LearningObjectiveWithCriteriaSchema>
export type SuccessCriteriaInput = z.infer<typeof SuccessCriteriaInputSchema>

export async function readLearningObjectivesByUnitAction(unitId: string) {
  console.log("[v0] Server action started for learning objectives:", { unitId })

  const { data, error } = await supabaseServer
    .from("learning_objectives")
    .select("*, success_criteria(*)")
    .eq("unit_id", unitId)
    .order("order_by", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true })

  if (error) {
    console.error("[v0] Failed to read learning objectives:", error)
    return LearningObjectivesReturnValue.parse({ data: null, error: error.message })
  }

  return LearningObjectivesReturnValue.parse({ data, error: null })
}

export async function createLearningObjectiveAction(
  unitId: string,
  title: string,
  successCriteria: SuccessCriteriaInput,
) {
  console.log("[v0] Server action started for learning objective creation:", { unitId, title })

  const sanitizedSuccessCriteria = SuccessCriteriaInputSchema.parse(
    successCriteria
      .map((criterion) => ({
        success_criteria_id: criterion.success_criteria_id,
        title: criterion.title.trim(),
      }))
      .filter((criterion) => criterion.title.length > 0),
  )

  const { data: learningObjective, error } = await supabaseServer
    .from("learning_objectives")
    .insert({ unit_id: unitId, title })
    .select("*, success_criteria(*)")
    .single()

  if (error) {
    console.error("[v0] Failed to create learning objective:", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  if (sanitizedSuccessCriteria.length > 0) {
    const { error: insertError } = await supabaseServer
      .from("success_criteria")
      .insert(
        sanitizedSuccessCriteria.map((criterion) => ({
          learning_objective_id: learningObjective.learning_objective_id,
          title: criterion.title,
        })),
      )

    if (insertError) {
      console.error("[v0] Failed to insert success criteria:", insertError)
      return LearningObjectiveReturnValue.parse({ data: null, error: insertError.message })
    }
  }

  const finalObjective = await readSingleLearningObjective(learningObjective.learning_objective_id)

  revalidatePath(`/units/${unitId}`)
  return finalObjective
}

export async function updateLearningObjectiveAction(
  learningObjectiveId: string,
  unitId: string,
  title: string,
  successCriteria: SuccessCriteriaInput,
) {
  console.log("[v0] Server action started for learning objective update:", {
    learningObjectiveId,
    unitId,
    title,
  })

  const sanitizedSuccessCriteria = SuccessCriteriaInputSchema.parse(
    successCriteria
      .map((criterion) => ({
        success_criteria_id: criterion.success_criteria_id,
        title: criterion.title.trim(),
      }))
      .filter((criterion) => criterion.title.length > 0),
  )

  const { error } = await supabaseServer
    .from("learning_objectives")
    .update({ title })
    .eq("learning_objective_id", learningObjectiveId)

  if (error) {
    console.error("[v0] Failed to update learning objective:", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  const { data: existingCriteria, error: readCriteriaError } = await supabaseServer
    .from("success_criteria")
    .select("*")
    .eq("learning_objective_id", learningObjectiveId)

  if (readCriteriaError) {
    console.error("[v0] Failed to read success criteria:", readCriteriaError)
    return LearningObjectiveReturnValue.parse({ data: null, error: readCriteriaError.message })
  }

  const existingIds = new Set((existingCriteria ?? []).map((criterion) => criterion.success_criteria_id))
  const incomingIds = new Set(
    sanitizedSuccessCriteria
      .map((criterion) => criterion.success_criteria_id)
      .filter((id): id is string => Boolean(id)),
  )

  const idsToDelete = Array.from(existingIds).filter((id) => !incomingIds.has(id))

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabaseServer
      .from("success_criteria")
      .delete()
      .in("success_criteria_id", idsToDelete)

    if (deleteError) {
      console.error("[v0] Failed to delete removed success criteria:", deleteError)
      return LearningObjectiveReturnValue.parse({ data: null, error: deleteError.message })
    }
  }

  const updates = sanitizedSuccessCriteria.filter((criterion) => criterion.success_criteria_id)
  for (const criterion of updates) {
    const { error: updateError } = await supabaseServer
      .from("success_criteria")
      .update({ title: criterion.title })
      .eq("success_criteria_id", criterion.success_criteria_id)

    if (updateError) {
      console.error("[v0] Failed to update success criterion:", updateError)
      return LearningObjectiveReturnValue.parse({ data: null, error: updateError.message })
    }
  }

  const inserts = sanitizedSuccessCriteria.filter((criterion) => !criterion.success_criteria_id)
  if (inserts.length > 0) {
    const { error: insertError } = await supabaseServer
      .from("success_criteria")
      .insert(
        inserts.map((criterion) => ({
          learning_objective_id: learningObjectiveId,
          title: criterion.title,
        })),
      )

    if (insertError) {
      console.error("[v0] Failed to insert new success criterion:", insertError)
      return LearningObjectiveReturnValue.parse({ data: null, error: insertError.message })
    }
  }

  const finalObjective = await readSingleLearningObjective(learningObjectiveId)

  revalidatePath(`/units/${unitId}`)
  return finalObjective
}

export async function deleteLearningObjectiveAction(learningObjectiveId: string, unitId: string) {
  console.log("[v0] Server action started for learning objective deletion:", { learningObjectiveId })

  const { error } = await supabaseServer
    .from("learning_objectives")
    .delete()
    .eq("learning_objective_id", learningObjectiveId)

  if (error) {
    console.error("[v0] Failed to delete learning objective:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

export async function reorderLearningObjectivesAction(
  unitId: string,
  ordering: { learningObjectiveId: string; orderBy: number }[],
) {
  console.log("[v0] Server action started for learning objective reordering:", {
    unitId,
    count: ordering.length,
  })

  const updates = [...ordering].sort((a, b) => a.orderBy - b.orderBy)

  for (const update of updates) {
    const { error } = await supabaseServer
      .from("learning_objectives")
      .update({ order_by: update.orderBy })
      .eq("learning_objective_id", update.learningObjectiveId)

    if (error) {
      console.error("[v0] Failed to reorder learning objective:", error)
      return { success: false, error: error.message }
    }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

async function readSingleLearningObjective(learningObjectiveId: string) {
  const { data, error } = await supabaseServer
    .from("learning_objectives")
    .select("*, success_criteria(*)")
    .eq("learning_objective_id", learningObjectiveId)
    .maybeSingle()

  if (error) {
    console.error("[v0] Failed to read learning objective:", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  return LearningObjectiveReturnValue.parse({ data, error: null })
}
