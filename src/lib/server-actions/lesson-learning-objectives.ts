"use server"

import { z } from "zod"

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server"

const LessonObjectiveLinkSchema = z.object({
  lessonId: z.string(),
  learningObjectiveId: z.string(),
  orderIndex: z.number().nullable().optional(),
  lessonObjectiveTitle: z.string().nullable().optional(),
  learningObjectiveTitle: z.string().nullable().optional(),
  assessmentObjectiveCode: z.string().nullable().optional(),
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
    .select("lesson_id, learning_objective_id, order_index, title")
    .in("lesson_id", normalizedIds)

  if (error) {
    console.error("[lesson-learning-objectives] Failed to list lesson objectives:", error)
    return LessonObjectiveLinksReturnValue.parse({ data: [], error: error.message })
  }

  const rows = data ?? []
  const learningObjectiveIds = Array.from(
    new Set(rows.map((row) => row.learning_objective_id).filter((value): value is string => Boolean(value))),
  )
  const learningObjectiveMeta = new Map<string, { title: string | null; assessmentObjectiveCode: string | null }>()

  if (learningObjectiveIds.length > 0) {
    let metadataClient: ReturnType<typeof createSupabaseServiceClient> | null = null

    try {
      metadataClient = createSupabaseServiceClient()
    } catch {
      // Service role key not configured; skip metadata enrichment to avoid noisy errors under RLS
    }

    if (metadataClient) {
      const { data: objectiveRows, error: objectiveError } = await metadataClient
        .from("learning_objectives")
        .select("learning_objective_id, title, assessment_objective_code")
        .in("learning_objective_id", learningObjectiveIds)

      if (objectiveError) {
        console.warn("[lesson-learning-objectives] Failed to read learning objective metadata:", objectiveError)
      } else {
        for (const objective of objectiveRows ?? []) {
          if (!objective.learning_objective_id) continue
          learningObjectiveMeta.set(objective.learning_objective_id, {
            title: typeof objective.title === "string" ? objective.title : null,
            assessmentObjectiveCode:
              typeof objective.assessment_objective_code === "string" ? objective.assessment_objective_code : null,
          })
        }
      }
    }
  }

  const payload = rows.map((row) => {
    const meta = row.learning_objective_id ? learningObjectiveMeta.get(row.learning_objective_id) : null

    return LessonObjectiveLinkSchema.parse({
      lessonId: row.lesson_id,
      learningObjectiveId: row.learning_objective_id,
      orderIndex:
        typeof row.order_index === "number" && Number.isFinite(row.order_index) ? row.order_index : null,
      lessonObjectiveTitle: typeof row.title === "string" ? row.title : null,
      learningObjectiveTitle: meta?.title ?? null,
      assessmentObjectiveCode: meta?.assessmentObjectiveCode ?? null,
    })
  })

  return LessonObjectiveLinksReturnValue.parse({ data: payload, error: null })
}
