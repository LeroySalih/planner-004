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
import { type NormalizedSuccessCriterion } from "./learning-objectives"

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

async function enrichLessonsWithSuccessCriteria<T extends { lesson_id?: string; lessons_learning_objective?: LessonLearningObjective[] }>(
  lessons: T[],
  options: { unitId?: string } = {},
): Promise<{ lessons: T[]; error: string | null }> {
  if (lessons.length === 0) {
    return { lessons: [], error: null }
  }

  const supabase = await createSupabaseServerClient()

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

  const loCriteriaMap = new Map<string, NormalizedSuccessCriterion[]>()
  let criteriaMetadataRows: Array<{
    success_criteria_id: string
    learning_objective_id: string | null
    description: string | null
    level: number | null
  }> = []

  const learningObjectiveMetadata = new Map<
    string,
    {
      title: string | null
      assessment_objective_id: string | null
      assessment_objective_title: string | null
      assessment_objective_code: string | null
      assessment_objective_order_index: number | null
      order_index: number | null
      active: boolean | null
    }
  >()

  const detailMap = new Map<
    string,
    {
      description: string | null
      level: number | null
      learning_objective_id: string | null
    }
  >()

  const lessonIds = Array.from(
    new Set(
      lessons
        .map((lesson) => lesson.lesson_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  )

  let lessonCriteriaRows: Array<{ lesson_id: string; success_criteria_id: string }> = []

  if (lessonIds.length > 0) {
    const { data: rows, error: lessonCriteriaError } = await supabase
      .from("lesson_success_criteria")
      .select("lesson_id, success_criteria_id")
      .in("lesson_id", lessonIds)

    if (lessonCriteriaError) {
      return { lessons: [], error: lessonCriteriaError.message }
    }

    lessonCriteriaRows = (rows ?? []).filter(
      (row): row is { lesson_id: string; success_criteria_id: string } =>
        typeof row?.lesson_id === "string" && typeof row?.success_criteria_id === "string",
    )

    const missingIds = Array.from(
      new Set(
        lessonCriteriaRows
          .map((row) => row.success_criteria_id)
          .filter((id) => id && !detailMap.has(id)),
      ),
    )

    if (missingIds.length > 0) {
      const { data: missingRows, error: missingError } = await supabase
        .from("success_criteria")
        .select("success_criteria_id, description, level, learning_objective_id")
        .in("success_criteria_id", missingIds)

      if (missingError) {
        return { lessons: [], error: missingError.message }
      }

      for (const row of missingRows ?? []) {
        if (!row?.success_criteria_id) continue
        const description = typeof row.description === "string" ? row.description : null
        const level = typeof row.level === "number" ? row.level : null
        const learningObjectiveId =
          typeof row.learning_objective_id === "string" ? row.learning_objective_id : null

        detailMap.set(row.success_criteria_id, {
          description,
          level,
          learning_objective_id: learningObjectiveId,
        })

        if (learningObjectiveId) {
          const normalized: NormalizedSuccessCriterion = {
            success_criteria_id: row.success_criteria_id,
            learning_objective_id: learningObjectiveId,
            level: level ?? 1,
            description: description ?? "",
            order_index: null,
            active: true,
            units: [],
          }
          const list = loCriteriaMap.get(learningObjectiveId) ?? []
          list.push(normalized)
          loCriteriaMap.set(learningObjectiveId, list)
          ids.add(learningObjectiveId)
        }
      }
    }
  }

  const lessonCriteriaMap = lessonCriteriaRows.reduce<
    Map<string, Array<{ success_criteria_id: string; learning_objective_id: string | null }>>
  >(
    (acc, row) => {
      const list = acc.get(row.lesson_id) ?? []
      const details = detailMap.get(row.success_criteria_id)
      list.push({
        success_criteria_id: row.success_criteria_id,
        learning_objective_id: details?.learning_objective_id ?? null,
      })
      acc.set(row.lesson_id, list)
      return acc
    },
    new Map(),
  )

  if (lessonCriteriaRows.length > 0) {
    const { data, error: criteriaMetadataError } = await supabase
      .from("success_criteria")
      .select("success_criteria_id, learning_objective_id, description, level")
      .in(
        "success_criteria_id",
        Array.from(new Set(lessonCriteriaRows.map((row) => row.success_criteria_id))).filter((id) => Boolean(id)),
      )

    if (criteriaMetadataError) {
      return { lessons: [], error: criteriaMetadataError.message }
    }

    criteriaMetadataRows = data ?? []
  }

  for (const row of criteriaMetadataRows) {
    if (!row?.success_criteria_id) continue
    const description = typeof row.description === "string" ? row.description : null
    const level = typeof row.level === "number" ? row.level : null
    const learningObjectiveId =
      typeof row.learning_objective_id === "string" ? row.learning_objective_id : null

    if (!detailMap.has(row.success_criteria_id)) {
      detailMap.set(row.success_criteria_id, {
        description,
        level,
        learning_objective_id: learningObjectiveId,
      })
    }

    if (learningObjectiveId) {
      const list = loCriteriaMap.get(learningObjectiveId) ?? []
      if (!list.some((entry) => entry.success_criteria_id === row.success_criteria_id)) {
        list.push({
          success_criteria_id: row.success_criteria_id,
          learning_objective_id: learningObjectiveId,
          level: level ?? 1,
          description: description ?? "",
          order_index: null,
          active: true,
          units: [],
        })
        loCriteriaMap.set(learningObjectiveId, list)
      }
      ids.add(learningObjectiveId)
    }
  }

  const criteriaToObjectiveMap = new Map<string, string>()
  for (const row of criteriaMetadataRows ?? []) {
    if (row?.success_criteria_id && row?.learning_objective_id) {
      criteriaToObjectiveMap.set(row.success_criteria_id, row.learning_objective_id)
      ids.add(row.learning_objective_id)
    }
  }

  const metadataIdsToFetch = Array.from(ids).filter((id) => !learningObjectiveMetadata.has(id))

  if (metadataIdsToFetch.length > 0) {
    const { data: learningObjectiveRows, error: learningObjectiveError } = await supabase
      .from("learning_objectives")
      .select(
        "learning_objective_id, title, assessment_objective_id, order_index, active, assessment_objective:assessment_objectives(code, title, order_index)"
      )
      .in("learning_objective_id", metadataIdsToFetch)

    if (learningObjectiveError) {
      return { lessons: [], error: learningObjectiveError.message }
    }

    for (const row of learningObjectiveRows ?? []) {
      if (!row?.learning_objective_id) continue
      const assessmentObjective = Array.isArray(row.assessment_objective)
        ? row.assessment_objective[0]
        : row.assessment_objective
      learningObjectiveMetadata.set(row.learning_objective_id, {
        title: typeof row.title === "string" ? row.title : null,
        assessment_objective_id:
          typeof row.assessment_objective_id === "string" ? row.assessment_objective_id : null,
        assessment_objective_title:
          typeof assessmentObjective?.title === "string" ? assessmentObjective.title : null,
        assessment_objective_code:
          typeof assessmentObjective?.code === "string" ? assessmentObjective.code : null,
        assessment_objective_order_index:
          typeof assessmentObjective?.order_index === "number" ? assessmentObjective.order_index : null,
        order_index: typeof row.order_index === "number" ? row.order_index : null,
        active: typeof row.active === "boolean" ? row.active : null,
      })
    }
  }


  const enriched = lessons.map((lesson) => {
    const linkedCriteria = lessonCriteriaMap.get(lesson.lesson_id ?? "") ?? []
    const updatedObjectives = (lesson.lessons_learning_objective ?? []).map((entry) => {
      const loId = entry.learning_objective_id ?? entry.learning_objective?.learning_objective_id ?? ""
      const successCriteria = loId ? loCriteriaMap.get(loId) ?? [] : []
      const metadata = loId ? learningObjectiveMetadata.get(loId) : null

      const mergedLearningObjective = loId
        ? {
            learning_objective_id: loId,
            assessment_objective_id: metadata?.assessment_objective_id ?? entry.learning_objective?.assessment_objective_id ?? null,
            assessment_objective_title: metadata?.assessment_objective_title ?? entry.learning_objective?.assessment_objective_title ?? null,
            assessment_objective_code: metadata?.assessment_objective_code ?? entry.learning_objective?.assessment_objective_code ?? null,
            assessment_objective_order_index:
              metadata?.assessment_objective_order_index ?? entry.learning_objective?.assessment_objective_order_index ?? null,
            title:
              metadata?.title ?? entry.learning_objective?.title ?? entry.title ?? "Learning objective",
            order_index: metadata?.order_index ?? entry.learning_objective?.order_index ?? entry.order_by ?? 0,
            active: metadata?.active ?? entry.learning_objective?.active ?? true,
            success_criteria: successCriteria,
            assessment_objective:
              metadata?.assessment_objective_id
                ? {
                    assessment_objective_id: metadata.assessment_objective_id,
                    code: metadata.assessment_objective_code,
                    title: metadata.assessment_objective_title,
                    order_index: metadata.assessment_objective_order_index,
                  }
                : entry.learning_objective && 'assessment_objective' in entry.learning_objective
                  ? (entry.learning_objective as Record<string, unknown>)?.assessment_objective ?? null
                  : null,
          }
        : entry.learning_objective

      return {
        ...entry,
        title: metadata?.title ?? entry.title ?? "Learning objective",
        learning_objective: entry.learning_objective
          ? {
              ...mergedLearningObjective,
            }
          : mergedLearningObjective,
      }
    })

    const existingObjectiveIds = new Set(
      updatedObjectives.map(
        (objective) => objective.learning_objective_id ?? objective.learning_objective?.learning_objective_id ?? "",
      ),
    )

    const lessonCriteria = (lessonCriteriaMap.get(lesson.lesson_id ?? "") ?? []).map((row) => {
      const details =
        detailMap.get(row.success_criteria_id) ?? ({
          description: null,
          level: null,
          learning_objective_id: null,
        } as const)

      const loIdFromCriterion =
        row.learning_objective_id ?? criteriaToObjectiveMap.get(row.success_criteria_id) ?? details.learning_objective_id

      const title =
        (details.description && details.description.trim().length > 0
          ? details.description.trim()
          : null) ?? "Success criterion"

      return {
        lesson_id: lesson.lesson_id ?? "",
        success_criteria_id: row.success_criteria_id,
        title,
        description: details.description,
        level: details.level,
        learning_objective_id: loIdFromCriterion,
      }
    })

    lessonCriteria.sort((a, b) => a.title.localeCompare(b.title))

    const derivedObjectives: LessonLearningObjective[] = []

    const groupedCriteria = lessonCriteria.reduce<Map<string, typeof lessonCriteria>>((acc, criterion) => {
      const loId = criterion.learning_objective_id ?? ""
      if (!loId) return acc
      const list = acc.get(loId) ?? []
      list.push(criterion)
      acc.set(loId, list)
      return acc
    }, new Map())

    for (const [loId, criteria] of groupedCriteria.entries()) {
      if (existingObjectiveIds.has(loId)) {
        continue
      }

      const metadata = learningObjectiveMetadata.get(loId) ?? {
        title: null,
        assessment_objective_id: null,
        assessment_objective_title: null,
        assessment_objective_code: null,
        assessment_objective_order_index: null,
        order_index: null,
        active: true,
      }

      const orderIndex = typeof metadata.order_index === "number"
        ? metadata.order_index
        : updatedObjectives.length + derivedObjectives.length

      derivedObjectives.push({
        learning_objective_id: loId,
        lesson_id: lesson.lesson_id ?? "",
        order_by: orderIndex,
        active: metadata.active ?? true,
        title: metadata.title ?? "Learning objective",
        learning_objective: {
          learning_objective_id: loId,
          assessment_objective_id: metadata.assessment_objective_id ?? "",
          assessment_objective_title: metadata.assessment_objective_title ?? null,
          assessment_objective_code: metadata.assessment_objective_code ?? null,
          assessment_objective_order_index: metadata.assessment_objective_order_index ?? null,
          title: metadata.title ?? "Learning objective",
          order_index: orderIndex,
          active: metadata.active ?? true,
          success_criteria: criteria.map((criterion, index) => ({
            success_criteria_id: criterion.success_criteria_id,
            learning_objective_id: loId,
            description: criterion.description ?? "",
            level: criterion.level ?? 1,
            order_index: index,
            active: true,
            units: [],
          })),
          assessment_objective: metadata.assessment_objective_id
            ? {
                assessment_objective_id: metadata.assessment_objective_id,
                code: metadata.assessment_objective_code,
                title: metadata.assessment_objective_title,
                order_index: metadata.assessment_objective_order_index,
              }
            : null,
        },
      })
    }

    const combinedObjectives = [...updatedObjectives, ...derivedObjectives].sort(
      (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
    )

    return {
      ...lesson,
      lessons_learning_objective: combinedObjectives as LessonLearningObjective[],
      lesson_success_criteria: lessonCriteria,
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

  const { lessons: enrichedLessons, error: scError } = await enrichLessonsWithSuccessCriteria([data], {
    unitId: data.unit_id,
  })

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
