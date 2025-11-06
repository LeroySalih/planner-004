"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonActivitySchema,
  LessonActivitiesSchema,
  McqActivityBodySchema,
  ShortTextActivityBodySchema,
  FeedbackActivityBodySchema,
  type FeedbackActivityGroupSettings,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { withTelemetry } from "@/lib/telemetry"
import { isScorableActivityType } from "@/dino.config"

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

const LessonActivitiesReturnValue = z.object({
  data: LessonActivitiesSchema.nullable(),
  error: z.string().nullable(),
})

const CreateActivityInputSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  bodyData: z.unknown().nullable().optional(),
  isHomework: z.boolean().optional(),
  isSummative: z.boolean().optional(),
  successCriteriaIds: z.array(z.string().min(1)).optional(),
})

const UpdateActivityInputSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  bodyData: z.unknown().nullable().optional(),
  isHomework: z.boolean().optional(),
  isSummative: z.boolean().optional(),
  successCriteriaIds: z.array(z.string().min(1)).optional(),
})

const ReorderActivityInputSchema = z
  .array(
    z.object({
      activityId: z.string(),
      orderBy: z.number(),
    }),
  )
  .max(200)

export async function listLessonActivitiesAction(
  lessonId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/lessons:activities"

  return withTelemetry(
    {
      routeTag,
      functionName: "listLessonActivitiesAction",
      params: { lessonId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      const supabase = await createSupabaseServerClient()

      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("lesson_id", lessonId)
        .eq("active", true)
        .order("order_by", { ascending: true, nullsFirst: true })
        .order("title", { ascending: true })

      if (error) {
        console.error("[v0] Failed to list lesson activities:", error)
        return LessonActivitiesReturnValue.parse({ data: null, error: error.message })
      }

      const sorted = (data ?? []).sort((a, b) => {
        const aOrder = typeof a.order_by === "number" ? a.order_by : Number.MAX_SAFE_INTEGER
        const bOrder = typeof b.order_by === "number" ? b.order_by : Number.MAX_SAFE_INTEGER
        if (aOrder !== bOrder) {
          return aOrder - bOrder
        }
        return (a.title ?? "").localeCompare(b.title ?? "")
      })

      const { data: enriched, error: scError } = await enrichActivitiesWithSuccessCriteria(supabase, sorted)

      if (scError) {
        console.error("[v0] Failed to read activity success criteria:", scError)
        return LessonActivitiesReturnValue.parse({ data: null, error: scError })
      }

      const sanitizedActivities = (enriched ?? []).map((activity) => {
        const activityType = typeof activity.type === "string" ? activity.type : null
        return isScorableActivityType(activityType) ? activity : { ...activity, is_summative: false }
      })

      return LessonActivitiesReturnValue.parse({ data: sanitizedActivities, error: null })
    },
  )
}

export async function createLessonActivityAction(
  unitId: string,
  lessonId: string,
  input: z.infer<typeof CreateActivityInputSchema>,
) {
  const payload = CreateActivityInputSchema.parse(input)

  const normalizedBody = normalizeActivityBody(payload.type, payload.bodyData)

  if (!normalizedBody.success) {
    return { success: false, error: normalizedBody.error, data: null }
  }

  const successCriteriaIds = normalizeSuccessCriteriaIds(payload.successCriteriaIds)
  const isSummativeRequested = payload.isSummative ?? false
  const isSummativeAllowed = isScorableActivityType(payload.type)

  if (isSummativeRequested && !isSummativeAllowed) {
    return {
      success: false,
      error: "Only scorable activity types can be marked as assessments.",
      data: null,
    }
  }

  const supabase = await createSupabaseServerClient()

  const { data: maxOrderActivity, error: maxOrderError } = await supabase
    .from("activities")
    .select("order_by")
    .eq("lesson_id", lessonId)
    .order("order_by", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (maxOrderError) {
    console.error("[v0] Failed to read existing activity order:", maxOrderError)
    return { success: false, error: maxOrderError.message, data: null }
  }

  const nextOrder = typeof maxOrderActivity?.order_by === "number" ? maxOrderActivity.order_by + 1 : 0

  const { data, error } = await supabase
    .from("activities")
    .insert({
      lesson_id: lessonId,
      title: payload.title,
      type: payload.type,
      body_data: normalizedBody.bodyData,
      is_homework: payload.isHomework ?? false,
      is_summative: isSummativeAllowed ? isSummativeRequested : false,
      order_by: nextOrder,
      active: true,
    })
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to create lesson activity:", error)
    return { success: false, error: error.message, data: null }
  }

  if (successCriteriaIds.length > 0) {
    const { error: linkError } = await supabase
      .from("activity_success_criteria")
      .insert(
        successCriteriaIds.map((successCriteriaId) => ({
          activity_id: data.activity_id,
          success_criteria_id: successCriteriaId,
        })),
      )

    if (linkError) {
      console.error("[v0] Failed to link success criteria to activity:", linkError)
      await supabase.from("activities").delete().eq("activity_id", data.activity_id)
      return { success: false, error: linkError.message, data: null }
    }
  }

  const { data: hydratedRows, error: hydrationError } = await enrichActivitiesWithSuccessCriteria(supabase, [data])

  if (hydrationError) {
    console.error("[v0] Failed to hydrate created activity success criteria:", hydrationError)
    return { success: false, error: hydrationError, data: null }
  }

  const hydratedActivity = hydratedRows[0] ?? {
    ...data,
    success_criteria_ids: successCriteriaIds,
    success_criteria: [],
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)

  return {
    success: true,
    data: LessonActivitySchema.parse(hydratedActivity),
  }
}

export async function updateLessonActivityAction(
  unitId: string,
  lessonId: string,
  activityId: string,
  input: z.infer<typeof UpdateActivityInputSchema>,
) {
  const payload = UpdateActivityInputSchema.parse(input)
  const updates: Record<string, unknown> = {}

  const supabase = await createSupabaseServerClient()

  const nextSuccessCriteriaIds =
    payload.successCriteriaIds !== undefined
      ? normalizeSuccessCriteriaIds(payload.successCriteriaIds)
      : null

  const { data: existing, error: existingError } = await supabase
    .from("activities")
    .select("*")
    .eq("activity_id", activityId)
    .eq("lesson_id", lessonId)
    .single()

  if (existingError) {
    console.error("[v0] Failed to load activity for update:", existingError)
    return { success: false, error: existingError.message, data: null }
  }

  const finalType = typeof payload.type === "string" ? payload.type : existing.type
  const isSummativeAllowed = isScorableActivityType(finalType)
  const requestedSummative = payload.isSummative

  if (requestedSummative === true && !isSummativeAllowed) {
    return {
      success: false,
      error: "Only scorable activity types can be marked as assessments.",
      data: null,
    }
  }

  const normalizedBody = (() => {
    if (payload.bodyData !== undefined) {
      return normalizeActivityBody(finalType, payload.bodyData)
    }

    if (payload.type !== undefined) {
      return normalizeActivityBody(finalType, existing.body_data, { allowFallback: true })
    }

    return { success: true as const, bodyData: existing.body_data }
  })()

  if (!normalizedBody.success) {
    return { success: false, error: normalizedBody.error, data: null }
  }

  if (payload.title !== undefined) {
    updates.title = payload.title
  }
  if (payload.type !== undefined) {
    updates.type = payload.type
  }
  if (payload.bodyData !== undefined || payload.type !== undefined) {
    updates.body_data = normalizedBody.bodyData
  }
  if (payload.isHomework !== undefined) {
    updates.is_homework = payload.isHomework ?? false
  }
  if (!isSummativeAllowed) {
    updates.is_summative = false
  } else if (requestedSummative !== undefined) {
    updates.is_summative = requestedSummative ?? false
  }

  if (Object.keys(updates).length === 0) {
    if (nextSuccessCriteriaIds === null) {
      return { success: true, data: null }
    }
  }

  let updatedActivityRow = existing

  if (Object.keys(updates).length > 0) {
    const { data, error } = await supabase
      .from("activities")
      .update(updates)
      .eq("activity_id", activityId)
      .eq("lesson_id", lessonId)
      .select("*")
      .single()

    if (error) {
      console.error("[v0] Failed to update lesson activity:", error)
      return { success: false, error: error.message, data: null }
    }

    updatedActivityRow = data
  }

  if (nextSuccessCriteriaIds !== null) {
    const { data: existingLinksRows, error: readLinksError } = await supabase
      .from("activity_success_criteria")
      .select("success_criteria_id")
      .eq("activity_id", activityId)

    if (readLinksError) {
      console.error("[v0] Failed to read existing activity success criteria:", readLinksError)
      return { success: false, error: readLinksError.message, data: null }
    }

    const existingIds = Array.from(
      new Set(
        (existingLinksRows ?? [])
          .map((row) => row?.success_criteria_id)
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    )

    const toInsert = nextSuccessCriteriaIds.filter((id) => !existingIds.includes(id))
    const toDelete = existingIds.filter((id) => !nextSuccessCriteriaIds.includes(id))

    if (toDelete.length > 0) {
      const { error: deleteLinksError } = await supabase
        .from("activity_success_criteria")
        .delete()
        .eq("activity_id", activityId)
        .in("success_criteria_id", toDelete)

      if (deleteLinksError) {
        console.error("[v0] Failed to remove activity success criteria links:", deleteLinksError)
        return { success: false, error: deleteLinksError.message, data: null }
      }
    }

    if (toInsert.length > 0) {
      const { error: insertLinksError } = await supabase
        .from("activity_success_criteria")
        .insert(
          toInsert.map((successCriteriaId) => ({
            activity_id: activityId,
            success_criteria_id: successCriteriaId,
          })),
        )

      if (insertLinksError) {
        console.error("[v0] Failed to add activity success criteria links:", insertLinksError)
        return { success: false, error: insertLinksError.message, data: null }
      }
    }
  }

  const { data: hydratedRows, error: hydrationError } = await enrichActivitiesWithSuccessCriteria(
    supabase,
    [updatedActivityRow],
  )

  if (hydrationError) {
    console.error("[v0] Failed to hydrate updated activity success criteria:", hydrationError)
    return { success: false, error: hydrationError, data: null }
  }

  const hydratedActivity = hydratedRows[0] ?? {
    ...updatedActivityRow,
    success_criteria_ids: nextSuccessCriteriaIds ?? [],
    success_criteria: [],
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)

  return { success: true, data: LessonActivitySchema.parse(hydratedActivity) }
}

export async function reorderLessonActivitiesAction(
  unitId: string,
  lessonId: string,
  input: z.infer<typeof ReorderActivityInputSchema>,
) {
  const payload = ReorderActivityInputSchema.parse(input)

  if (payload.length === 0) {
    return { success: true }
  }

  const activityIds = payload.map((entry) => entry.activityId)

  const supabase = await createSupabaseServerClient()

  const { data: existing, error: existingError } = await supabase
    .from("activities")
    .select("activity_id")
    .eq("lesson_id", lessonId)
    .in("activity_id", activityIds)

  if (existingError) {
    console.error("[v0] Failed to verify lesson activities for reorder:", existingError)
    return { success: false, error: existingError.message }
  }

  if ((existing ?? []).length !== activityIds.length) {
    return { success: false, error: "Some activities were not found for this lesson." }
  }

  const { error } = await supabase
    .from("activities")
    .upsert(
      payload.map((entry) => ({
        activity_id: entry.activityId,
        order_by: entry.orderBy,
      })),
      { onConflict: "activity_id" },
    )

  if (error) {
    console.error("[v0] Failed to reorder lesson activities:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)

  return { success: true }
}

export async function deleteLessonActivityAction(unitId: string, lessonId: string, activityId: string) {
  const supabase = await createSupabaseServerClient()

  const { error: linkDeleteError } = await supabase
    .from("activity_success_criteria")
    .delete()
    .eq("activity_id", activityId)

  if (linkDeleteError) {
    console.error("[v0] Failed to remove success criteria for activity:", linkDeleteError)
    return { success: false, error: linkDeleteError.message }
  }

  const { error } = await supabase
    .from("activities")
    .delete()
    .eq("activity_id", activityId)
    .eq("lesson_id", lessonId)

  if (error) {
    console.error("[v0] Failed to delete lesson activity:", error)
    return { success: false, error: error.message }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)

  return { success: true }
}

function normalizeSuccessCriteriaIds(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const deduped: string[] = []
  value.forEach((raw) => {
    if (typeof raw !== "string") {
      return
    }
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return
    }
    if (!deduped.includes(trimmed)) {
      deduped.push(trimmed)
    }
  })
  return deduped
}

async function enrichActivitiesWithSuccessCriteria(
  supabase: SupabaseServerClient,
  activities: Array<Record<string, unknown>>,
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
  if (activities.length === 0) {
    return {
      data: activities.map((activity) => ({
        ...activity,
        success_criteria_ids: [],
        success_criteria: [],
      })),
      error: null,
    }
  }

  const activityIds = Array.from(
    new Set(
      activities
        .map((activity) => activity.activity_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  )

  if (activityIds.length === 0) {
    return {
      data: activities.map((activity) => ({
        ...activity,
        success_criteria_ids: [],
        success_criteria: [],
      })),
      error: null,
    }
  }

  const { data: linkRows, error: linksError } = await supabase
    .from("activity_success_criteria")
    .select("activity_id, success_criteria_id")
    .in("activity_id", activityIds)

  if (linksError) {
    return { data: [], error: linksError.message }
  }

  const normalizedLinks =
    linkRows?.filter(
      (row): row is { activity_id: string; success_criteria_id: string } =>
        typeof row?.activity_id === "string" &&
        row.activity_id.trim().length > 0 &&
        typeof row?.success_criteria_id === "string" &&
        row.success_criteria_id.trim().length > 0,
    ) ?? []

  const criteriaIds = Array.from(new Set(normalizedLinks.map((row) => row.success_criteria_id)))

  const criteriaMap = new Map<
    string,
    { success_criteria_id: string; learning_objective_id: string | null; description: string | null; level: number | null; active: boolean | null }
  >()

  const objectiveMap = new Map<string, { title: string | null }>()

  if (criteriaIds.length > 0) {
    const { data: criteriaRows, error: criteriaError } = await supabase
      .from("success_criteria")
      .select("success_criteria_id, learning_objective_id, description, level, active")
      .in("success_criteria_id", criteriaIds)

    if (criteriaError) {
      return { data: [], error: criteriaError.message }
    }

    const normalizedCriteria =
      criteriaRows?.map((row) => ({
        success_criteria_id: row?.success_criteria_id ?? "",
        learning_objective_id: row?.learning_objective_id ?? null,
        description: typeof row?.description === "string" ? row.description : null,
        level: typeof row?.level === "number" ? row.level : null,
        active: typeof row?.active === "boolean" ? row.active : null,
      })) ?? []

    normalizedCriteria.forEach((criterion) => {
      if (criterion.success_criteria_id) {
        criteriaMap.set(criterion.success_criteria_id, criterion)
      }
    })

    const objectiveIds = Array.from(
      new Set(
        normalizedCriteria
          .map((criterion) => criterion.learning_objective_id)
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    )

    if (objectiveIds.length > 0) {
      const { data: objectiveRows, error: objectiveError } = await supabase
        .from("learning_objectives")
        .select("learning_objective_id, title")
        .in("learning_objective_id", objectiveIds)

      if (objectiveError) {
        return { data: [], error: objectiveError.message }
      }

      objectiveRows?.forEach((objective) => {
        const id = typeof objective?.learning_objective_id === "string" ? objective.learning_objective_id : null
        if (!id) return
        const title =
          typeof objective?.title === "string" && objective.title.trim().length > 0
            ? objective.title.trim()
            : null
        objectiveMap.set(id, { title })
      })
    }
  }

  const linksByActivity = normalizedLinks.reduce<Map<string, string[]>>((acc, row) => {
    const existing = acc.get(row.activity_id) ?? []
    if (!existing.includes(row.success_criteria_id)) {
      existing.push(row.success_criteria_id)
    }
    acc.set(row.activity_id, existing)
    return acc
  }, new Map())

  const enriched = activities.map((activity) => {
    const activityId = typeof activity.activity_id === "string" ? activity.activity_id : ""
    const linkedIds = linksByActivity.get(activityId) ?? []
    const uniqueIds = Array.from(new Set(linkedIds))

    const successCriteria = uniqueIds
      .map((id) => {
        const base = criteriaMap.get(id)
        if (!base) {
          return null
        }

        const objectiveTitle =
          base.learning_objective_id && objectiveMap.has(base.learning_objective_id)
            ? objectiveMap.get(base.learning_objective_id)?.title ?? null
            : null

        const rawTitle =
          (typeof base.description === "string" && base.description.trim().length > 0
            ? base.description.trim()
            : null) ??
          (objectiveTitle && objectiveTitle.trim().length > 0 ? objectiveTitle.trim() : null)

        return {
          success_criteria_id: id,
          learning_objective_id: base.learning_objective_id,
          title: rawTitle ?? "Success criterion",
          description: base.description,
          level: base.level,
          active: base.active,
        }
      })
      .filter(
        (
          entry,
        ): entry is {
          success_criteria_id: string
          learning_objective_id: string | null
          title: string
          description: string | null
          level: number | null
          active: boolean | null
        } => entry !== null,
      )

    return {
      ...activity,
      success_criteria_ids: uniqueIds,
      success_criteria: successCriteria,
    }
  })

  return { data: enriched, error: null }
}

const TextActivityBodySchema = z.object({ text: z.string() }).passthrough()
const UploadFileBodySchema = z
  .object({
    instructions: z.string().nullable().optional(),
  })
  .passthrough()
const VideoActivityBodySchema = z.object({ fileUrl: z.string() }).passthrough()
const VoiceActivityBodySchema = z
  .object({
    audioFile: z.string().min(1).nullable().optional(),
    mimeType: z.string().nullable().optional(),
    duration: z.number().nonnegative().nullable().optional(),
    size: z.number().nonnegative().nullable().optional(),
  })
  .passthrough()
const FeedbackGroupDefaults: FeedbackActivityGroupSettings = {
  isEnabled: false,
  showScore: false,
  showCorrectAnswers: false,
}

function normalizeActivityBody(
  type: string,
  rawBody: unknown,
  options: { allowFallback?: boolean } = {},
):
  | { success: true; bodyData: unknown }
  | { success: false; error: string } {
  const { allowFallback = false } = options

  if (type === "text") {
    if (rawBody === undefined || rawBody === null) {
      return { success: true, bodyData: { text: "" } }
    }

    if (typeof rawBody === "string") {
      return { success: true, bodyData: { text: rawBody } }
    }

    if (typeof rawBody === "object") {
      const parsed = TextActivityBodySchema.safeParse(rawBody)
      if (parsed.success) {
        return { success: true, bodyData: { text: parsed.data.text } }
      }
    }

    if (allowFallback) {
      return { success: true, bodyData: { text: "" } }
    }

    return { success: false, error: "Text activities require textual content." }
  }

  if (type === "show-video") {
    if (rawBody === undefined || rawBody === null) {
      return { success: true, bodyData: { fileUrl: "" } }
    }

    if (typeof rawBody === "string") {
      return { success: true, bodyData: { fileUrl: rawBody } }
    }

    if (typeof rawBody === "object") {
      const parsed = VideoActivityBodySchema.safeParse(rawBody)
      if (parsed.success) {
        return { success: true, bodyData: { fileUrl: parsed.data.fileUrl } }
      }
    }

    if (allowFallback) {
      return { success: true, bodyData: { fileUrl: "" } }
    }

    return { success: false, error: "Video activities require a URL." }
  }

  if (type === "voice") {
    if (rawBody === undefined || rawBody === null) {
      return { success: true, bodyData: { audioFile: null } }
    }

    if (typeof rawBody === "object") {
      const parsed = VoiceActivityBodySchema.safeParse(rawBody)
      if (parsed.success) {
        const { audioFile = null, mimeType = null, duration = null, size = null, ...rest } = parsed.data
        return {
          success: true,
          bodyData: {
            audioFile,
            mimeType,
            duration,
            size,
            ...rest,
          },
        }
      }
    }

    if (allowFallback) {
      return { success: true, bodyData: { audioFile: null } }
    }

    return { success: false, error: "Voice activities require a recording." }
  }

  if (type === "upload-file") {
    if (rawBody === undefined || rawBody === null) {
      return { success: true, bodyData: { instructions: "" } }
    }

    if (typeof rawBody === "string") {
      return { success: true, bodyData: { instructions: rawBody } }
    }

    if (typeof rawBody === "object") {
      const parsed = UploadFileBodySchema.safeParse(rawBody)
      if (parsed.success) {
        const instructions = parsed.data.instructions ?? ""
        return { success: true, bodyData: { ...parsed.data, instructions } }
      }
    }

    if (allowFallback) {
      return { success: true, bodyData: { instructions: "" } }
    }

    return { success: false, error: "Upload file activities require instructions." }
  }

  if (type === "multiple-choice-question") {
    const defaultOptions = [
      { id: "option-a", text: "" },
      { id: "option-b", text: "" },
      { id: "option-c", text: "" },
      { id: "option-d", text: "" },
    ] as const

    const defaultBody = {
      question: "",
      imageFile: null,
      imageUrl: null,
      imageAlt: null,
      options: [...defaultOptions],
      correctOptionId: defaultOptions[0].id,
    }

    if (rawBody === undefined || rawBody === null) {
      return { success: true, bodyData: defaultBody }
    }

    if (typeof rawBody === "object") {
      const parsed = McqActivityBodySchema.safeParse(rawBody)
      if (parsed.success) {
        const normalizedOptions = parsed.data.options.map((option, index) => {
          const trimmedId = option.id.trim()
          const trimmedText = option.text.trim()
          return {
            id: trimmedId || `option-${index + 1}`,
            text: trimmedText,
            imageUrl: typeof option.imageUrl === "string" ? option.imageUrl.trim() || null : null,
          }
        })

        const hasValidCorrectOption = normalizedOptions.some(
          (option) => option.id === parsed.data.correctOptionId,
        )

        const fallbackCorrectOptionId = normalizedOptions[0]?.id ?? defaultBody.correctOptionId

        return {
          success: true,
          bodyData: {
            question: parsed.data.question.trim(),
            imageFile: parsed.data.imageFile?.trim() || null,
            imageUrl: parsed.data.imageUrl?.trim() || null,
            imageAlt: parsed.data.imageAlt?.trim() || null,
            options: normalizedOptions,
            correctOptionId: hasValidCorrectOption
              ? parsed.data.correctOptionId
              : fallbackCorrectOptionId,
          },
        }
      }
    }

    if (allowFallback) {
      return { success: true, bodyData: defaultBody }
    }

    return { success: false, error: "Multiple choice activities require a question and options." }
  }

  if (type === "short-text-question") {
    const defaultBody = { question: "", modelAnswer: "" }

    if (rawBody === undefined || rawBody === null) {
      return { success: true, bodyData: defaultBody }
    }

    if (typeof rawBody === "object") {
      const parsed = ShortTextActivityBodySchema.safeParse(rawBody)
      if (parsed.success) {
        return {
          success: true,
          bodyData: {
            ...parsed.data,
            question: parsed.data.question.trim(),
            modelAnswer: parsed.data.modelAnswer.trim(),
          },
        }
      }
    }

    if (allowFallback) {
      return { success: true, bodyData: defaultBody }
    }

    return { success: false, error: "Short text activities require a question and model answer." }
  }

  if (type === "feedback") {
    const defaultBody = { groups: {} as Record<string, FeedbackActivityGroupSettings> }

    if (rawBody === undefined || rawBody === null) {
      return { success: true, bodyData: defaultBody }
    }

    if (typeof rawBody === "object") {
      const parsed = FeedbackActivityBodySchema.safeParse(rawBody)
      if (parsed.success) {
        const normalizedGroups = Object.entries(parsed.data.groups ?? {}).reduce<
          Record<string, FeedbackActivityGroupSettings>
        >((acc, [groupId, settings]) => {
          const trimmedId = groupId.trim()
          if (trimmedId.length === 0) {
            return acc
          }
          acc[trimmedId] = {
            ...FeedbackGroupDefaults,
            isEnabled: settings?.isEnabled === true,
            showScore: settings?.showScore === true,
            showCorrectAnswers: settings?.showCorrectAnswers === true,
          }
          return acc
        }, {})

        const rest = { ...parsed.data } as Record<string, unknown>
        delete rest.groups
        return { success: true, bodyData: { ...rest, groups: normalizedGroups } }
      }
    }

    if (allowFallback) {
      return { success: true, bodyData: defaultBody }
    }

    return { success: false, error: "Feedback activities require configuration for assigned groups." }
  }

  return { success: true, bodyData: rawBody ?? null }
}
