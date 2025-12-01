"use server"

import { z } from "zod"

import { query } from "@/lib/db"

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

  try {
    const { rows } = await query<{
      lesson_id: string
      learning_objective_id: string
      order_index: number | null
      title: string | null
    }>(
      `
        select lesson_id, learning_objective_id, order_index, title
        from lessons_learning_objective
        where lesson_id = any($1::text[])
      `,
      [normalizedIds],
    )

    const learningObjectiveIds = Array.from(
      new Set(rows.map((row) => row.learning_objective_id).filter((value): value is string => Boolean(value))),
    )

    const learningObjectiveMeta = new Map<string, { title: string | null; assessmentObjectiveCode: string | null }>()

    if (learningObjectiveIds.length > 0) {
      const { rows: objectiveRows } = await query<{
        learning_objective_id: string
        title: string | null
        assessment_objective_code: string | null
      }>(
        `
          select learning_objective_id, title, assessment_objective_code
          from learning_objectives
          where learning_objective_id = any($1::text[])
        `,
        [learningObjectiveIds],
      )

      for (const objective of objectiveRows ?? []) {
        if (!objective.learning_objective_id) continue
        learningObjectiveMeta.set(objective.learning_objective_id, {
          title: typeof objective.title === "string" ? objective.title : null,
          assessmentObjectiveCode:
            typeof objective.assessment_objective_code === "string" ? objective.assessment_objective_code : null,
        })
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
  } catch (error) {
    console.error("[lesson-learning-objectives] Failed to list lesson objectives:", error)
    const message = error instanceof Error ? error.message : "Unable to load lesson objectives."
    return LessonObjectiveLinksReturnValue.parse({ data: [], error: message })
  }
}
