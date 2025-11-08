"use server"

import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import { LessonDetailPayloadSchema, type LessonDetailPayload } from "@/lib/lesson-snapshot-schema"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function fetchLessonDetailPayload(
  lessonId: string,
  supabaseOverride?: SupabaseClient,
): Promise<{ data: LessonDetailPayload | null; error: string | null }> {
  const supabase = supabaseOverride ?? (await createSupabaseServerClient())

  const { data, error } = await supabase.rpc("lesson_detail_bootstrap", { p_lesson_id: lessonId })

  if (error) {
    return { data: null, error: error.message }
  }

  const parsed = LessonDetailPayloadSchema.safeParse(data)
  if (!parsed.success) {
    return { data: null, error: "Unable to parse lesson detail payload" }
  }

  return { data: parsed.data, error: null }
}
