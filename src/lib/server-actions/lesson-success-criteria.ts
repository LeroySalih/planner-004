"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonSuccessCriteriaSchema,
  LessonSuccessCriterionSchema,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireTeacherProfile } from "@/lib/auth"

const LessonSuccessCriteriaReturnValue = z.object({
  data: LessonSuccessCriteriaSchema.default([]),
  error: z.string().nullable(),
})

const mutateInputSchema = z.object({
  lessonId: z.string().min(1),
  successCriteriaId: z.string().min(1),
})

export async function listLessonSuccessCriteriaAction(lessonId: string) {
  const supabase = await createSupabaseServerClient()

  const { data: linkRows, error: linkError } = await supabase
    .from("lesson_success_criteria")
    .select("lesson_id, success_criteria_id")
    .eq("lesson_id", lessonId)

  if (linkError) {
    console.error("[lesson-success-criteria] Failed to read lesson success criteria:", linkError)
    return LessonSuccessCriteriaReturnValue.parse({ data: [], error: linkError.message })
  }


  const ids = Array.from(
    new Set(
      (linkRows ?? [])
        .map((row) => row?.success_criteria_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  )

  if (ids.length === 0) {
    return LessonSuccessCriteriaReturnValue.parse({ data: [], error: null })
  }

  const { data: criteriaRows, error: criteriaError } = await supabase
    .from("success_criteria")
    .select("success_criteria_id, learning_objective_id, description, level")
    .in("success_criteria_id", ids)

  if (criteriaError) {
    console.error("[lesson-success-criteria] Failed to load success criteria metadata:", criteriaError)
    return LessonSuccessCriteriaReturnValue.parse({ data: [], error: criteriaError.message })
  }


  const detailMap = new Map<string, { description: string | null; level: number | null; learning_objective_id: string | null }>()
  for (const row of criteriaRows ?? []) {
    if (!row?.success_criteria_id) continue
    detailMap.set(row.success_criteria_id, {
      description: typeof row.description === "string" ? row.description : null,
      level: typeof row.level === "number" ? row.level : null,
      learning_objective_id: typeof row.learning_objective_id === "string" ? row.learning_objective_id : null,
    })
  }

  const payload = (linkRows ?? []).map((row) => {
    const details = detailMap.get(row.success_criteria_id ?? "") ?? {
      description: null,
      level: null,
      learning_objective_id: null,
    }

    const title =
      (details.description && details.description.trim().length > 0 ? details.description.trim() : null) ??
      "Success criterion"

    return LessonSuccessCriterionSchema.parse({
      lesson_id: row.lesson_id,
      success_criteria_id: row.success_criteria_id,
      title,
      description: details.description,
      level: details.level,
      learning_objective_id: details.learning_objective_id,
    })
  })

  payload.sort((a, b) => a.title.localeCompare(b.title))

  return LessonSuccessCriteriaReturnValue.parse({ data: payload, error: null })
}

export async function linkLessonSuccessCriterionAction(input: z.infer<typeof mutateInputSchema>) {
  await requireTeacherProfile()

  const payload = mutateInputSchema.parse(input)

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("lesson_success_criteria")
    .insert({
      lesson_id: payload.lessonId,
      success_criteria_id: payload.successCriteriaId,
    })

  if (error) {
    console.error("[lesson-success-criteria] Failed to link success criterion:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/lessons/${payload.lessonId}`)
  return { success: true, error: null }
}

export async function unlinkLessonSuccessCriterionAction(input: z.infer<typeof mutateInputSchema>) {
  await requireTeacherProfile()

  const payload = mutateInputSchema.parse(input)

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("lesson_success_criteria")
    .delete()
    .eq("lesson_id", payload.lessonId)
    .eq("success_criteria_id", payload.successCriteriaId)

  if (error) {
    console.error("[lesson-success-criteria] Failed to unlink success criterion:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/lessons/${payload.lessonId}`)
  return { success: true, error: null }
}
