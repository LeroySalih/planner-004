"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { LessonAssignmentSchema, LessonAssignmentsSchema } from "@/types"
import { supabaseServer } from "@/lib/supabaseClient"

const LessonAssignmentReturnValue = z.object({
  data: LessonAssignmentSchema.nullable(),
  error: z.string().nullable(),
})

const LessonAssignmentsReturnValue = z.object({
  data: LessonAssignmentsSchema.nullable(),
  error: z.string().nullable(),
})

export type LessonAssignmentActionResult = z.infer<typeof LessonAssignmentReturnValue>

export async function readLessonAssignmentsAction() {
  console.log("[v0] Server action started for reading lesson assignments")

  const { data, error } = await supabaseServer
    .from("lesson_assignments")
    .select("*")

  if (error) {
    console.error("[v0] Server action failed for reading lesson assignments:", error)
    return LessonAssignmentsReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for reading lesson assignments")

  return LessonAssignmentsReturnValue.parse({ data, error: null })
}

export async function upsertLessonAssignmentAction(groupId: string, lessonId: string, startDate: string) {
  console.log("[v0] Server action started for upserting lesson assignment:", {
    groupId,
    lessonId,
    startDate,
  })

  const { data: existing, error: readError } = await supabaseServer
    .from("lesson_assignments")
    .select("*")
    .eq("group_id", groupId)
    .eq("lesson_id", lessonId)
    .maybeSingle()

  if (readError && readError.code !== "PGRST116") {
    console.error("[v0] Server action failed to read existing lesson assignment:", readError)
    return LessonAssignmentReturnValue.parse({ data: null, error: readError.message })
  }

  let resultData = existing ?? null

  if (existing) {
    const { data, error } = await supabaseServer
      .from("lesson_assignments")
      .update({ start_date: startDate })
      .eq("group_id", groupId)
      .eq("lesson_id", lessonId)
      .select()
      .single()

    if (error) {
      console.error("[v0] Server action failed for updating lesson assignment:", error)
      return LessonAssignmentReturnValue.parse({ data: null, error: error.message })
    }

    resultData = data
  } else {
    const { data, error } = await supabaseServer
      .from("lesson_assignments")
      .insert({ group_id: groupId, lesson_id: lessonId, start_date: startDate })
      .select()
      .single()

    if (error) {
      console.error("[v0] Server action failed for inserting lesson assignment:", error)
      return LessonAssignmentReturnValue.parse({ data: null, error: error.message })
    }

    resultData = data
  }

  console.log("[v0] Server action completed for upserting lesson assignment:", {
    groupId,
    lessonId,
    startDate,
  })

  revalidatePath("/assignments")
  return LessonAssignmentReturnValue.parse({ data: resultData, error: null })
}

export async function deleteLessonAssignmentAction(groupId: string, lessonId: string) {
  console.log("[v0] Server action started for deleting lesson assignment:", { groupId, lessonId })

  const { error } = await supabaseServer
    .from("lesson_assignments")
    .delete()
    .eq("group_id", groupId)
    .eq("lesson_id", lessonId)

  if (error) {
    console.error("[v0] Server action failed for deleting lesson assignment:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for deleting lesson assignment:", { groupId, lessonId })

  revalidatePath("/assignments")
  return { success: true }
}
