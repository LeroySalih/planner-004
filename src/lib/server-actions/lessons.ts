"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { LessonSchema, LessonsSchema } from "@/types"
import { supabaseServer } from "@/lib/supabaseClient"

const LessonsReturnValue = z.object({
  data: LessonsSchema.nullable(),
  error: z.string().nullable(),
})

const LessonReturnValue = z.object({
  data: LessonSchema.nullable(),
  error: z.string().nullable(),
})

export async function readLessonsByUnitAction(unitId: string) {
  console.log("[v0] Server action started for lessons:", { unitId })

  const { data, error } = await supabaseServer
    .from("lessons")
    .select("*")
    .eq("unit_id", unitId)
    .order("title", { ascending: true })

  if (error) {
    console.error("[v0] Failed to read lessons:", error)
    return LessonsReturnValue.parse({ data: null, error: error.message })
  }

  return LessonsReturnValue.parse({ data, error: null })
}

export async function createLessonAction(unitId: string, title: string) {
  console.log("[v0] Server action started for lesson creation:", { unitId, title })

  const { data, error } = await supabaseServer
    .from("lessons")
    .insert({ unit_id: unitId, title, active: true })
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to create lesson:", error)
    return LessonReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath(`/units/${unitId}`)
  return LessonReturnValue.parse({ data, error: null })
}

export async function updateLessonAction(lessonId: string, unitId: string, title: string) {
  console.log("[v0] Server action started for lesson update:", { lessonId, unitId, title })

  const { data, error } = await supabaseServer
    .from("lessons")
    .update({ title })
    .eq("lesson_id", lessonId)
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to update lesson:", error)
    return LessonReturnValue.parse({ data: null, error: error.message })
  }

  revalidatePath(`/units/${unitId}`)
  return LessonReturnValue.parse({ data, error: null })
}

export async function deactivateLessonAction(lessonId: string, unitId: string) {
  console.log("[v0] Server action started for lesson deactivation:", { lessonId, unitId })

  const { error } = await supabaseServer
    .from("lessons")
    .update({ active: false })
    .eq("lesson_id", lessonId)

  if (error) {
    console.error("[v0] Failed to deactivate lesson:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}
