"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { LessonActivitySchema, LessonActivitiesSchema } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const LessonActivitiesReturnValue = z.object({
  data: LessonActivitiesSchema.nullable(),
  error: z.string().nullable(),
})

const CreateActivityInputSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  bodyData: z.unknown().nullable().optional(),
  isHomework: z.boolean().optional(),
})

const UpdateActivityInputSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  bodyData: z.unknown().nullable().optional(),
  isHomework: z.boolean().optional(),
})

const ReorderActivityInputSchema = z
  .array(
    z.object({
      activityId: z.string(),
      orderBy: z.number(),
    }),
  )
  .max(200)

export async function listLessonActivitiesAction(lessonId: string) {
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

  return LessonActivitiesReturnValue.parse({ data: sorted, error: null })
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
      order_by: nextOrder,
      active: true,
    })
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to create lesson activity:", error)
    return { success: false, error: error.message, data: null }
  }

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)

  return {
    success: true,
    data: LessonActivitySchema.parse(data),
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

  const { data: existing, error: existingError } = await supabase
    .from("activities")
    .select("activity_id, type, body_data")
    .eq("activity_id", activityId)
    .eq("lesson_id", lessonId)
    .single()

  if (existingError) {
    console.error("[v0] Failed to load activity for update:", existingError)
    return { success: false, error: existingError.message, data: null }
  }

  const finalType = typeof payload.type === "string" ? payload.type : existing.type

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

  if (Object.keys(updates).length === 0) {
    return { success: true, data: null }
  }

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

  revalidatePath(`/units/${unitId}`)
  revalidatePath(`/lessons/${lessonId}`)

  return { success: true, data: LessonActivitySchema.parse(data) }
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

const TextActivityBodySchema = z.object({ text: z.string() }).passthrough()
const VideoActivityBodySchema = z.object({ fileUrl: z.string() }).passthrough()
const VoiceActivityBodySchema = z
  .object({
    audioFile: z.string().min(1).nullable().optional(),
    mimeType: z.string().nullable().optional(),
    duration: z.number().nonnegative().nullable().optional(),
    size: z.number().nonnegative().nullable().optional(),
  })
  .passthrough()

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

  return { success: true, bodyData: rawBody ?? null }
}
