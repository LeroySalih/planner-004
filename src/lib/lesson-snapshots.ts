"use server"

import { z } from "zod"

import { LessonDetailPayloadSchema, type LessonDetailPayload } from "@/lib/lesson-snapshot-schema"
import { query } from "@/lib/db"

export async function fetchLessonDetailPayload(
  lessonId: string,
): Promise<{ data: LessonDetailPayload | null; error: string | null }> {
  try {
    const { rows } = await query("select lesson_detail_bootstrap($1) as payload", [lessonId])
    const data = rows?.[0]?.payload ?? null

    const parsed = LessonDetailPayloadSchema.safeParse(data)
    if (!parsed.success) {
      return { data: null, error: "Unable to parse lesson detail payload" }
    }

    return { data: parsed.data, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load lesson detail."
    return { data: null, error: message }
  }
}
