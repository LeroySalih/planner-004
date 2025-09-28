"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonLearningObjective,
  LessonLink,
  LessonWithObjectivesSchema,
  LessonsWithObjectivesSchema,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { fetchSuccessCriteriaForLearningObjectives } from "./learning-objectives"

const LessonsReturnValue = z.object({
  data: LessonsWithObjectivesSchema.nullable(),
  error: z.string().nullable(),
})

const LessonReturnValue = z.object({
  data: LessonWithObjectivesSchema.nullable(),
  error: z.string().nullable(),
})

const ObjectiveIdsSchema = z.array(z.string()).max(50)

export async function readLessonsByUnitAction(unitId: string) {
  console.log("[v0] Server action started for lessons:", { unitId })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("lessons")
    .select(
      `*,
        lessons_learning_objective(
          *,
          learning_objective:learning_objectives(
            *,
            assessment_objective:assessment_objectives(*)
          )
        ),
        lesson_links(*)
      `,
    )
    .eq("unit_id", unitId)
    .order("order_by", { ascending: true })
    .order("title", { ascending: true })

  if (error) {
    console.error("[v0] Failed to read lessons:", error)
    return LessonsReturnValue.parse({ data: null, error: error.message })
  }

  const lessons = data ?? []

  const { lessons: enrichedLessons, error: scError } = await enrichLessonsWithSuccessCriteria(lessons, {
    unitId,
  })

  if (scError) {
    console.error("[v0] Failed to read success criteria for lessons:", scError)
    return LessonsReturnValue.parse({ data: null, error: scError })
  }

  const normalized = enrichedLessons.map((lesson) => {
    const { lessons_learning_objective, lesson_links, ...rest } = lesson
    const filtered = ((lessons_learning_objective ?? []) as LessonLearningObjective[])
      .filter((entry) => entry.active !== false)
      .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    return {
      ...rest,
      lesson_objectives: filtered,
      lesson_links: ((lesson_links ?? []) as LessonLink[]).map((link) => ({
        lesson_link_id: link.lesson_link_id,
        lesson_id: link.lesson_id,
        url: link.url,
        description: link.description,
      })),
    }
  })

  return LessonsReturnValue.parse({ data: normalized, error: null })
}

export async function readLessonsAction() {
  console.log("[v0] Server action started for all lessons")

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("lessons")
    .select(
      `*,
        lessons_learning_objective(
          *,
          learning_objective:learning_objectives(
            *,
            assessment_objective:assessment_objectives(*)
          )
        ),
        lesson_links(*)
      `,
    )
    .order("unit_id", { ascending: true })
    .order("order_by", { ascending: true, nullsFirst: true })
    .order("title", { ascending: true })

  if (error) {
    console.error("[v0] Failed to read all lessons:", error)
    return LessonsReturnValue.parse({ data: null, error: error.message })
  }

  const lessons = data ?? []

  const { lessons: enrichedLessons, error: scError } = await enrichLessonsWithSuccessCriteria(lessons)

  if (scError) {
    console.error("[v0] Failed to read success criteria for all lessons:", scError)
    return LessonsReturnValue.parse({ data: null, error: scError })
  }

  const normalized = enrichedLessons.map((lesson) => {
    const { lessons_learning_objective, lesson_links, ...rest } = lesson
    const filtered = ((lessons_learning_objective ?? []) as LessonLearningObjective[])
      .filter((entry) => entry.active !== false)
      .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    return {
      ...rest,
      lesson_objectives: filtered,
      lesson_links: ((lesson_links ?? []) as LessonLink[]).map((link) => ({
        lesson_link_id: link.lesson_link_id,
        lesson_id: link.lesson_id,
        url: link.url,
        description: link.description,
      })),
    }
  })

  return LessonsReturnValue.parse({ data: normalized, error: null })
}

export async function createLessonAction(unitId: string, title: string, objectiveIds: string[] = []) {
  console.log("[v0] Server action started for lesson creation:", { unitId, title })

  const sanitizedObjectiveIds = ObjectiveIdsSchema.parse(objectiveIds)

  const supabase = await createSupabaseServerClient()

  const { data: maxOrderLesson } = await supabase
    .from("lessons")
    .select("order_by")
    .eq("unit_id", unitId)
    .order("order_by", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrder = (maxOrderLesson?.order_by ?? -1) + 1

  const { data, error } = await supabase
    .from("lessons")
    .insert({ unit_id: unitId, title, active: true, order_by: nextOrder })
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to create lesson:", error)
    return LessonReturnValue.parse({ data: null, error: error.message })
  }

  if (sanitizedObjectiveIds.length > 0) {
    const { error: linkError } = await supabase
      .from("lessons_learning_objective")
      .insert(
        sanitizedObjectiveIds.map((learningObjectiveId, index) => ({
          learning_objective_id: learningObjectiveId,
          lesson_id: data.lesson_id,
          order_by: index,
          title,
          active: true,
        })),
      )

    if (linkError) {
      console.error("[v0] Failed to link objectives to lesson:", linkError)
      return LessonReturnValue.parse({ data: null, error: linkError.message })
    }
  }

  revalidatePath(`/units/${unitId}`)
  return readLessonWithObjectives(data.lesson_id)
}

export async function updateLessonAction(
  lessonId: string,
  unitId: string,
  title: string,
  objectiveIds: string[] = [],
) {
  console.log("[v0] Server action started for lesson update:", { lessonId, unitId, title })

  const sanitizedObjectiveIds = ObjectiveIdsSchema.parse(objectiveIds)

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("lessons")
    .update({ title })
    .eq("lesson_id", lessonId)
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to update lesson:", error)
    return LessonReturnValue.parse({ data: null, error: error.message })
  }

  const { data: existingLinks, error: readLinksError } = await supabase
    .from("lessons_learning_objective")
    .select("learning_objective_id")
    .eq("lesson_id", lessonId)

  if (readLinksError) {
    console.error("[v0] Failed to read lesson links:", readLinksError)
    return LessonReturnValue.parse({ data: null, error: readLinksError.message })
  }

  const existingIds = new Set((existingLinks ?? []).map((link) => link.learning_objective_id))
  const incomingIds = new Set(sanitizedObjectiveIds)

  const idsToDelete = Array.from(existingIds).filter((id) => !incomingIds.has(id))
  const idsToInsert = sanitizedObjectiveIds.filter((id) => !existingIds.has(id))

  // Update order and ensure active for retained objectives
  for (const [index, learningObjectiveId] of sanitizedObjectiveIds.entries()) {
    if (existingIds.has(learningObjectiveId)) {
      const { error: updateLinkError } = await supabase
        .from("lessons_learning_objective")
        .update({ order_by: index, active: true })
        .eq("lesson_id", lessonId)
        .eq("learning_objective_id", learningObjectiveId)

      if (updateLinkError) {
        console.error("[v0] Failed to update lesson link order:", updateLinkError)
        return LessonReturnValue.parse({ data: null, error: updateLinkError.message })
      }
    }
  }

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("lessons_learning_objective")
      .delete()
      .eq("lesson_id", lessonId)
      .in("learning_objective_id", idsToDelete)

    if (deleteError) {
      console.error("[v0] Failed to remove lesson links:", deleteError)
      return LessonReturnValue.parse({ data: null, error: deleteError.message })
    }
  }

  if (idsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("lessons_learning_objective")
      .insert(
        idsToInsert.map((learningObjectiveId) => ({
          learning_objective_id: learningObjectiveId,
          lesson_id: lessonId,
          order_by: sanitizedObjectiveIds.indexOf(learningObjectiveId),
          title,
          active: true,
        })),
      )

    if (insertError) {
      console.error("[v0] Failed to insert lesson links:", insertError)
      return LessonReturnValue.parse({ data: null, error: insertError.message })
    }
  }

  revalidatePath(`/units/${unitId}`)
  return readLessonWithObjectives(data.lesson_id)
}

export async function deactivateLessonAction(lessonId: string, unitId: string) {
  console.log("[v0] Server action started for lesson deactivation:", { lessonId, unitId })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
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

export async function reorderLessonsAction(
  unitId: string,
  ordering: { lessonId: string; orderBy: number }[],
) {
  console.log("[v0] Server action started for lesson reordering:", {
    unitId,
    count: ordering.length,
  })

  const updates = ordering.sort((a, b) => a.orderBy - b.orderBy)

  const supabase = await createSupabaseServerClient()

  for (const update of updates) {
    const { error } = await supabase
      .from("lessons")
      .update({ order_by: update.orderBy })
      .eq("lesson_id", update.lessonId)

    if (error) {
      console.error("[v0] Failed to reorder lesson:", error)
      return { success: false, error: error.message }
    }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

async function enrichLessonsWithSuccessCriteria<T extends { lessons_learning_objective?: LessonLearningObjective[] }>(
  lessons: T[],
  options: { unitId?: string } = {},
): Promise<{ lessons: T[]; error: string | null }> {
  const ids = new Set<string>()

  for (const lesson of lessons) {
    for (const entry of lesson.lessons_learning_objective ?? []) {
      if (entry.learning_objective_id) {
        ids.add(entry.learning_objective_id)
      }

      const nestedId = entry.learning_objective?.learning_objective_id
      if (nestedId) {
        ids.add(nestedId)
      }
    }
  }

  if (ids.size === 0) {
    return { lessons: lessons.map((lesson) => ({ ...lesson })), error: null }
  }

  const { map, error } = await fetchSuccessCriteriaForLearningObjectives([...ids], options.unitId)

  if (error) {
    return { lessons: [], error }
  }

  const enriched = lessons.map((lesson) => {
    const updatedObjectives = (lesson.lessons_learning_objective ?? []).map((entry) => {
      const loId = entry.learning_objective_id ?? entry.learning_objective?.learning_objective_id ?? ""
      const successCriteria = loId ? map.get(loId) ?? [] : []

      return {
        ...entry,
        learning_objective: entry.learning_objective
          ? {
              ...entry.learning_objective,
              success_criteria: successCriteria,
            }
          : entry.learning_objective,
      }
    })

    return {
      ...lesson,
      lessons_learning_objective: updatedObjectives as LessonLearningObjective[],
    }
  })

  return { lessons: enriched, error: null }
}

async function readLessonWithObjectives(lessonId: string) {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("lessons")
    .select(
      `*,
        lessons_learning_objective(
          *,
          learning_objective:learning_objectives(
            *,
            assessment_objective:assessment_objectives(*)
          )
        ),
        lesson_links(*)
      `,
    )
    .eq("lesson_id", lessonId)
    .maybeSingle()

  if (error) {
    console.error("[v0] Failed to read lesson:", error)
    return LessonReturnValue.parse({ data: null, error: error.message })
  }

  if (!data) {
    return LessonReturnValue.parse({ data: null, error: null })
  }

  const { lessons: enrichedLessons, error: scError } = await enrichLessonsWithSuccessCriteria([data])

  if (scError) {
    console.error("[v0] Failed to read success criteria for lesson:", scError)
    return LessonReturnValue.parse({ data: null, error: scError })
  }

  const lesson = enrichedLessons[0]

  const { lessons_learning_objective, lesson_links, ...rest } = lesson
  const normalized = {
    ...rest,
    lesson_objectives: ((lessons_learning_objective ?? []) as LessonLearningObjective[])
      .filter((entry) => entry.active !== false)
      .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
    lesson_links: ((lesson_links ?? []) as LessonLink[]).map((link) => ({
      lesson_link_id: link.lesson_link_id,
      lesson_id: link.lesson_id,
      url: link.url,
      description: link.description,
    })),
  }

  return LessonReturnValue.parse({ data: normalized, error: null })
}

export async function readLessonAction(lessonId: string) {
  console.log("[v0] Server action started for lesson read:", { lessonId })
  return readLessonWithObjectives(lessonId)
}
