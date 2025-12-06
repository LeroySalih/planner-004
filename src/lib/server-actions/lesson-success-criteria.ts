"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonSuccessCriteriaSchema,
  LessonSuccessCriterionSchema,
} from "@/types"
import { requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"

const LessonSuccessCriteriaReturnValue = z.object({
  data: LessonSuccessCriteriaSchema.default([]),
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

const mutateInputSchema = z.object({
  lessonId: z.string().min(1),
  successCriteriaId: z.string().min(1),
})

export async function listLessonSuccessCriteriaAction(lessonId: string) {
  try {
    const { rows } = await query<{
      lesson_id: string
      success_criteria_id: string
      description: string | null
      level: number | null
      learning_objective_id: string | null
    }>(
      `
        select l.lesson_id,
               l.success_criteria_id,
               sc.description,
               sc.level,
               sc.learning_objective_id
        from lesson_success_criteria l
        left join success_criteria sc on sc.success_criteria_id = l.success_criteria_id
        where l.lesson_id = $1
      `,
      [lessonId],
    )

    const payload = (rows ?? []).map((row) => {
      const title =
        row.description && row.description.trim().length > 0 ? row.description.trim() : "Success criterion"
      return LessonSuccessCriterionSchema.parse({
        lesson_id: row.lesson_id,
        success_criteria_id: row.success_criteria_id,
        title,
        description: row.description ?? null,
        level: row.level ?? null,
        learning_objective_id: row.learning_objective_id ?? null,
      })
    })

    payload.sort((a, b) => a.title.localeCompare(b.title))

    return LessonSuccessCriteriaReturnValue.parse({ data: payload, error: null })
  } catch (error) {
    console.error("[lesson-success-criteria] Failed to read lesson success criteria:", error)
    const message = error instanceof Error ? error.message : "Unable to load success criteria."
    return LessonSuccessCriteriaReturnValue.parse({ data: [], error: message })
  }
}

export async function listLessonsSuccessCriteriaAction(lessonIds: string[]) {
  const normalizedIds = normalizeLessonIds(lessonIds)
  if (normalizedIds.length === 0) {
    return LessonSuccessCriteriaReturnValue.parse({ data: [], error: null })
  }

  try {
    const { rows } = await query<{
      lesson_id: string
      success_criteria_id: string
      description: string | null
      level: number | null
      learning_objective_id: string | null
    }>(
      `
        select l.lesson_id,
               l.success_criteria_id,
               sc.description,
               sc.level,
               sc.learning_objective_id
        from lesson_success_criteria l
        left join success_criteria sc on sc.success_criteria_id = l.success_criteria_id
        where l.lesson_id = any($1::text[])
      `,
      [normalizedIds],
    )

    const payload = (rows ?? []).map((row) => {
      const title =
        row.description && row.description.trim().length > 0 ? row.description.trim() : "Success criterion"
      return LessonSuccessCriterionSchema.parse({
        lesson_id: row.lesson_id,
        success_criteria_id: row.success_criteria_id,
        title,
        description: row.description ?? null,
        level: row.level ?? null,
        learning_objective_id: row.learning_objective_id ?? null,
      })
    })

    payload.sort((a, b) => {
      if (a.lesson_id === b.lesson_id) {
        return a.title.localeCompare(b.title)
      }
      return a.lesson_id.localeCompare(b.lesson_id)
    })

    return LessonSuccessCriteriaReturnValue.parse({ data: payload, error: null })
  } catch (error) {
    console.error("[lesson-success-criteria] Failed to read lesson success criteria:", error)
    const message = error instanceof Error ? error.message : "Unable to load success criteria."
    return LessonSuccessCriteriaReturnValue.parse({ data: [], error: message })
  }
}

export async function linkLessonSuccessCriterionAction(input: z.infer<typeof mutateInputSchema>) {
  await requireTeacherProfile()

  const payload = mutateInputSchema.parse(input)

  try {
    await query(
      `
        insert into lesson_success_criteria (lesson_id, success_criteria_id)
        values ($1, $2)
        on conflict do nothing
      `,
      [payload.lessonId, payload.successCriteriaId],
    )

  return { success: true, error: null }
  } catch (error) {
    console.error("[lesson-success-criteria] Failed to link success criterion:", error)
    const message = error instanceof Error ? error.message : "Unable to link success criterion."
    return { success: false, error: message }
  }
}

export async function unlinkLessonSuccessCriterionAction(input: z.infer<typeof mutateInputSchema>) {
  await requireTeacherProfile()

  const payload = mutateInputSchema.parse(input)

  try {
    await query(
      `
        delete from lesson_success_criteria
        where lesson_id = $1 and success_criteria_id = $2
      `,
      [payload.lessonId, payload.successCriteriaId],
    )

  return { success: true, error: null }
  } catch (error) {
    console.error("[lesson-success-criteria] Failed to unlink success criterion:", error)
    const message = error instanceof Error ? error.message : "Unable to unlink success criterion."
    return { success: false, error: message }
  }
}
