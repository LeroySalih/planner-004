"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createSupabaseServerClient } from "@/lib/supabase/server"

const LessonLinkSchema = z.object({
  lesson_link_id: z.string(),
  lesson_id: z.string(),
  url: z.string().url(),
  description: z.string().nullable(),
})

const LessonLinksReturnValue = z.object({
  data: z.array(LessonLinkSchema).nullable(),
  error: z.string().nullable(),
})

export async function listLessonLinksAction(lessonId: string) {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("lesson_links")
    .select("*")
    .eq("lesson_id", lessonId)
    .order("lesson_link_id")

  if (error) {
    console.error("[v0] Failed to list lesson links:", error)
    return LessonLinksReturnValue.parse({ data: null, error: error.message })
  }

  return LessonLinksReturnValue.parse({ data, error: null })
}

export async function createLessonLinkAction(
  unitId: string,
  lessonId: string,
  url: string,
  description: string | null,
) {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("lesson_links")
    .insert({
      lesson_id: lessonId,
      url,
      description,
    })
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to create lesson link:", error)
    return { success: false, error: error.message, data: null }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)
  return { success: true, data }
}

export async function updateLessonLinkAction(
  unitId: string,
  lessonId: string,
  lessonLinkId: string,
  url: string,
  description: string | null,
) {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("lesson_links")
    .update({ url, description })
    .eq("lesson_link_id", lessonLinkId)
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to update lesson link:", error)
    return { success: false, error: error.message, data: null }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)
  return { success: true, data }
}

export async function deleteLessonLinkAction(unitId: string, lessonId: string, lessonLinkId: string) {
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("lesson_links")
    .delete()
    .eq("lesson_link_id", lessonLinkId)

  if (error) {
    console.error("[v0] Failed to delete lesson link:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)
  return { success: true }
}
