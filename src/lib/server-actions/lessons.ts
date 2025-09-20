"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonWithObjectivesSchema,
  LessonsWithObjectivesSchema,
} from "@/types"
import { supabaseServer } from "@/lib/supabaseClient"

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

  const { data, error } = await supabaseServer
    .from("lessons")
    .select(
      "*, lessons_learning_objective(*, learning_objective:learning_objectives(*)), lesson_links(*)",
    )
    .eq("unit_id", unitId)
    .order("order_by", { ascending: true })
    .order("title", { ascending: true })

  if (error) {
    console.error("[v0] Failed to read lessons:", error)
    return LessonsReturnValue.parse({ data: null, error: error.message })
  }

  const normalized = (data ?? []).map((lesson) => {
    const { lessons_learning_objective, lesson_links, ...rest } = lesson
    const filtered = (lessons_learning_objective ?? [])
      .filter((entry) => entry.active !== false)
      .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))
    return {
      ...rest,
      lesson_objectives: filtered,
      lesson_links: (lesson_links ?? []).map((link) => ({
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

  const { data: maxOrderLesson } = await supabaseServer
    .from("lessons")
    .select("order_by")
    .eq("unit_id", unitId)
    .order("order_by", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrder = (maxOrderLesson?.order_by ?? -1) + 1

  const { data, error } = await supabaseServer
    .from("lessons")
    .insert({ unit_id: unitId, title, active: true, order_by: nextOrder })
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to create lesson:", error)
    return LessonReturnValue.parse({ data: null, error: error.message })
  }

  if (sanitizedObjectiveIds.length > 0) {
    const { error: linkError } = await supabaseServer
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

  const { data: existingLinks, error: readLinksError } = await supabaseServer
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
      const { error: updateLinkError } = await supabaseServer
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
    const { error: deleteError } = await supabaseServer
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
    const { error: insertError } = await supabaseServer
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

export async function reorderLessonsAction(
  unitId: string,
  ordering: { lessonId: string; orderBy: number }[],
) {
  console.log("[v0] Server action started for lesson reordering:", {
    unitId,
    count: ordering.length,
  })

  const updates = ordering.sort((a, b) => a.orderBy - b.orderBy)

  for (const update of updates) {
    const { error } = await supabaseServer
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

async function readLessonWithObjectives(lessonId: string) {
  const { data, error } = await supabaseServer
    .from("lessons")
    .select(
      "*, lessons_learning_objective(*, learning_objective:learning_objectives(*)), lesson_links(*)",
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

  const { lessons_learning_objective, lesson_links, ...rest } = data
  const normalized = {
    ...rest,
    lesson_objectives: (lessons_learning_objective ?? [])
      .filter((entry) => entry.active !== false)
      .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)),
    lesson_links: (lesson_links ?? []).map((link) => ({
      lesson_link_id: link.lesson_link_id,
      lesson_id: link.lesson_id,
      url: link.url,
      description: link.description,
    })),
  }

  return LessonReturnValue.parse({ data: normalized, error: null })
}
