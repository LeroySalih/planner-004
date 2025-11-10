"use server"

import { z } from "zod"

import { createSupabaseServerClient } from "@/lib/supabase/server"

const LessonObjectiveLinkSchema = z.object({
  lessonId: z.string(),
  learningObjectiveId: z.string(),
  orderIndex: z.number().nullable().optional(),
})

const LessonObjectiveLinksReturnValue = z.object({
  data: z.array(LessonObjectiveLinkSchema).default([]),
  error: z.string().nullable(),
})

function normalizeLessonIds(lessonIds: string[]): string[] {
  return Array.from(
    new Set(
      lessonIds
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value && value.length > 0)),
    ),
  )
}

export async function listLessonsLearningObjectivesAction(lessonIds: string[]) {
  const normalizedIds = normalizeLessonIds(lessonIds)
  if (normalizedIds.length === 0) {
    return LessonObjectiveLinksReturnValue.parse({ data: [], error: null })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from("lessons_learning_objective")
    .select("lesson_id, learning_objective_id, order_index")
    .in("lesson_id", normalizedIds)

  if (error) {
    console.error("[lesson-learning-objectives] Failed to list lesson objectives:", error)
    return LessonObjectiveLinksReturnValue.parse({ data: [], error: error.message })
  }

  const payload = (data ?? []).map((row) =>
    LessonObjectiveLinkSchema.parse({
      lessonId: row.lesson_id,
      learningObjectiveId: row.learning_objective_id,
      orderIndex:
        typeof row.order_index === "number" && Number.isFinite(row.order_index) ? row.order_index : null,
    }),
  )

  return LessonObjectiveLinksReturnValue.parse({ data: payload, error: null })
}
