"use server"

import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  AssessmentObjectivesSchema,
  CurriculaSchema,
  LearningObjectiveWithCriteriaSchema,
  LessonJobPayloadSchema,
  LessonLearningObjective,
  LessonLink,
  LessonMutationStateSchema,
  LessonWithObjectivesSchema,
  LessonsWithObjectivesSchema,
  SuccessCriterionSchema,
} from "@/types"
import {
  type LessonObjectiveFormState,
  type LessonSuccessCriterionFormState,
} from "@/lib/lesson-form-state"
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server"
import { type NormalizedSuccessCriterion } from "./learning-objectives"
import { isScorableActivityType } from "@/dino.config"
import { requireTeacherProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
import { LESSON_CHANNEL_NAME, LESSON_CREATED_EVENT } from "@/lib/lesson-channel"
import { enqueueLessonMutationJob } from "@/lib/lesson-job-runner"
import { LessonDetailPayloadSchema } from "@/lib/lesson-snapshot-schema"

const LessonsReturnValue = z.object({
  data: LessonsWithObjectivesSchema.nullable(),
  error: z.string().nullable(),
})

const LessonReturnValue = z.object({
  data: LessonWithObjectivesSchema.nullable(),
  error: z.string().nullable(),
})

const LessonDetailReturnValue = z.object({
  data: LessonDetailPayloadSchema.nullable(),
  error: z.string().nullable(),
})

const LessonReferencePayloadSchema = z.object({
  curricula: CurriculaSchema.default([]),
  assessmentObjectives: AssessmentObjectivesSchema.default([]),
})

const LessonReferenceReturnValue = z.object({
  data: LessonReferencePayloadSchema.nullable(),
  error: z.string().nullable(),
})

const ObjectiveIdsSchema = z.array(z.string()).max(50)

const LessonObjectiveMutationResultSchema = z.object({
  data: LearningObjectiveWithCriteriaSchema.nullable(),
  error: z.string().nullable(),
})

const LessonSuccessCriterionMutationResultSchema = z.object({
  data: SuccessCriterionSchema.nullable(),
  error: z.string().nullable(),
})

const LESSON_ROUTE_TAG = "/units/[unitId]"
const LESSON_CHANNEL_CONFIG = { config: { broadcast: { ack: true } } }

type LessonSupabaseClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>

async function publishLessonJobEvent(
  supabase: LessonSupabaseClient,
  payloadInput: z.input<typeof LessonJobPayloadSchema>,
) {
  const payload = LessonJobPayloadSchema.parse(payloadInput)
  const channel = supabase.channel(LESSON_CHANNEL_NAME, LESSON_CHANNEL_CONFIG)

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const subscribeResult = channel.subscribe((status) => {
        if (settled) return
        if (status === "SUBSCRIBED") {
          settled = true
          resolve()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          settled = true
          reject(new Error(`Realtime channel subscription failed with status: ${status}`))
        }
      })

      if (subscribeResult instanceof Promise) {
        subscribeResult.catch((error) => {
          if (!settled) {
            settled = true
            reject(error)
          }
        })
      }
    })

    const sendResult = await channel.send({
      type: "broadcast",
      event: LESSON_CREATED_EVENT,
      payload,
    })

    if (sendResult !== "ok") {
      const status =
        typeof sendResult === "string"
          ? sendResult
          : (sendResult as { status?: string })?.status ?? "ok"

      if (status !== "ok") {
        throw new Error(`Realtime channel send failed with status: ${status}`)
      }
    }

    console.info("[lessons] published lesson job event", {
      event: LESSON_CREATED_EVENT,
      jobId: payload.job_id,
      unitId: payload.unit_id,
      lessonId: payload.lesson_id,
    })
  } finally {
    await supabase.removeChannel(channel)
  }
}

type LessonCreateJobArgs = {
  supabase: LessonSupabaseClient
  jobId: string
  unitId: string
  title: string
}

async function runLessonCreateJob({ supabase, jobId, unitId, title }: LessonCreateJobArgs) {
  try {
    const { data: maxOrderLesson, error: orderError } = await supabase
      .from("lessons")
      .select("order_by")
      .eq("unit_id", unitId)
      .order("order_by", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (orderError) {
      throw orderError
    }

    const nextOrder = (maxOrderLesson?.order_by ?? -1) + 1

    const { data, error } = await supabase
      .from("lessons")
      .insert({ unit_id: unitId, title, active: true, order_by: nextOrder })
      .select("*")
      .single()

    if (error) {
      throw error
    }

    const lessonId = data.lesson_id

    await publishLessonJobEvent(supabase, {
      job_id: jobId,
      unit_id: unitId,
      lesson_id: lessonId,
      status: "completed",
      message: "Lesson created successfully.",
      lesson: {
        lesson_id: lessonId,
        unit_id: unitId,
        title,
        order_by: data.order_by ?? nextOrder,
        active: true,
        lesson_objectives: [],
        lesson_links: [],
        lesson_success_criteria: [],
      },
    })
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message ?? "Failed to create lesson")
        : "Failed to create lesson"

    console.error("[lessons] async create lesson job failed", { unitId, jobId, error })

    try {
      await publishLessonJobEvent(supabase, {
        job_id: jobId,
        unit_id: unitId,
        lesson_id: null,
        status: "error",
        message,
        lesson: null,
      })
    } catch (notifyError) {
      console.error("[lessons] failed to publish lesson job error", { jobId, notifyError })
    }
  }
}

export async function readLessonsByUnitAction(
  unitId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/lessons:byUnit"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLessonsByUnitAction",
      params: { unitId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
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

      const { lessons: enrichedLessons, error: scError } = await enrichLessonsWithSuccessCriteria(lessons)

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
    },
  )
}

export async function readLessonsAction(options?: { authEndTime?: number | null; routeTag?: string }) {
  const routeTag = options?.routeTag ?? "/lessons:readLessons"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLessonsAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
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
    },
  )
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

export async function triggerLessonCreateJobAction(
  _prevState: z.infer<typeof LessonMutationStateSchema>,
  formData: FormData,
) {
  const profile = await requireTeacherProfile()
  const authEnd = performance.now()

  const rawUnitId = formData.get("unitId")
  const rawTitle = formData.get("title")
  const unitId = typeof rawUnitId === "string" ? rawUnitId.trim() : ""
  const title = typeof rawTitle === "string" ? rawTitle.trim() : ""

  return withTelemetry(
    {
      routeTag: LESSON_ROUTE_TAG,
      functionName: "triggerLessonCreateJobAction",
      params: { unitId: unitId || null },
      authEndTime: authEnd,
    },
    async () => {
      if (!unitId) {
        return LessonMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Unit id is required.",
        })
      }

      if (title.length === 0) {
        return LessonMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Lesson title is required.",
        })
      }

      const supabase = await createSupabaseServiceClient()
      const jobId = randomUUID()

      queueMicrotask(() => {
        void runLessonCreateJob({
          supabase,
          jobId,
          unitId,
          title,
        })
      })

      console.info("[lessons] queued lesson create job", {
        jobId,
        unitId,
        title,
        userId: profile.userId,
      })

      return LessonMutationStateSchema.parse({
        status: "queued",
        jobId,
        message: "Lesson creation queued.",
      })
    },
  )
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

const LessonSuccessCriteriaUpdateSchema = z.object({
  lessonId: z.string().min(1),
  unitId: z.string().min(1),
  successCriteriaIds: z.array(z.string().min(1)).default([]),
})

export async function setLessonSuccessCriteriaAction(
  lessonId: string,
  unitId: string,
  successCriteriaIds: string[],
) {
  await requireTeacherProfile()

  const payload = LessonSuccessCriteriaUpdateSchema.parse({
    lessonId,
    unitId,
    successCriteriaIds,
  })

  return enqueueLessonMutationJob({
    lessonId: payload.lessonId,
    unitId: payload.unitId,
    type: "lesson.successCriteria",
    message: "Lesson success criteria update queued.",
    executor: async ({ supabase }) => {
      await applyLessonSuccessCriteriaUpdate(supabase, payload)
    },
  })
}

async function applyLessonSuccessCriteriaUpdate(
  supabase: SupabaseClient,
  payload: z.infer<typeof LessonSuccessCriteriaUpdateSchema>,
) {
  const normalizedIds = Array.from(new Set(payload.successCriteriaIds))

  const { data: existingCriteriaLinks, error: existingCriteriaError } = await supabase
    .from("lesson_success_criteria")
    .select("success_criteria_id")
    .eq("lesson_id", payload.lessonId)

  if (existingCriteriaError) {
    throw existingCriteriaError
  }

  const existingCriteriaIds = new Set(
    (existingCriteriaLinks ?? [])
      .map((link) => link.success_criteria_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )

  const idsToInsert = normalizedIds.filter((id) => !existingCriteriaIds.has(id))
  const idsToDelete = Array.from(existingCriteriaIds).filter((id) => !normalizedIds.includes(id))

  if (idsToInsert.length > 0) {
    const { error: insertCriteriaError } = await supabase.from("lesson_success_criteria").insert(
      idsToInsert.map((successCriteriaId) => ({
        lesson_id: payload.lessonId,
        success_criteria_id: successCriteriaId,
      })),
    )

    if (insertCriteriaError) {
      throw insertCriteriaError
    }
  }

  if (idsToDelete.length > 0) {
    const { error: deleteCriteriaError } = await supabase
      .from("lesson_success_criteria")
      .delete()
      .eq("lesson_id", payload.lessonId)
      .in("success_criteria_id", idsToDelete)

    if (deleteCriteriaError) {
      throw deleteCriteriaError
    }
  }

  let learningObjectiveIdsFromSelection: string[] = []

  if (normalizedIds.length > 0) {
    const { data: criteriaMetadata, error: criteriaMetadataError } = await supabase
      .from("success_criteria")
      .select("success_criteria_id, learning_objective_id")
      .in("success_criteria_id", normalizedIds)

    if (criteriaMetadataError) {
      throw criteriaMetadataError
    }

    learningObjectiveIdsFromSelection = Array.from(
      new Set(
        (criteriaMetadata ?? [])
          .map((row) => row.learning_objective_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    )
  }

  const { data: existingObjectiveLinks, error: objectiveReadError } = await supabase
    .from("lessons_learning_objective")
    .select("learning_objective_id, order_by")
    .eq("lesson_id", payload.lessonId)

  if (objectiveReadError) {
    throw objectiveReadError
  }

  const existingObjectiveOrderMap = new Map<string, number>()
  for (const row of existingObjectiveLinks ?? []) {
    if (!row?.learning_objective_id) continue
    existingObjectiveOrderMap.set(
      row.learning_objective_id,
      typeof row.order_by === "number" ? row.order_by : existingObjectiveOrderMap.size,
    )
  }

  const existingObjectiveIds = new Set(existingObjectiveOrderMap.keys())
  const objectiveIdsToRemove = Array.from(existingObjectiveIds).filter(
    (id) => !learningObjectiveIdsFromSelection.includes(id),
  )
  const objectiveIdsToInsert = learningObjectiveIdsFromSelection.filter(
    (id) => !existingObjectiveIds.has(id),
  )

  if (objectiveIdsToRemove.length > 0) {
    const { error: objectiveDeleteError } = await supabase
      .from("lessons_learning_objective")
      .delete()
      .eq("lesson_id", payload.lessonId)
      .in("learning_objective_id", objectiveIdsToRemove)

    if (objectiveDeleteError) {
      throw objectiveDeleteError
    }
  }

  if (objectiveIdsToInsert.length > 0) {
    const { data: learningObjectiveMetadata, error: learningObjectiveError } = await supabase
      .from("learning_objectives")
      .select("learning_objective_id, title")
      .in("learning_objective_id", objectiveIdsToInsert)

    if (learningObjectiveError) {
      throw learningObjectiveError
    }

    const existingOrders = Array.from(existingObjectiveOrderMap.values())
    const maxExistingOrder = existingOrders.length > 0 ? Math.max(...existingOrders) : -1

    const insertRows = (learningObjectiveMetadata ?? []).map((meta, index) => ({
      lesson_id: payload.lessonId,
      learning_objective_id: meta.learning_objective_id,
      order_by: maxExistingOrder + index + 1,
      title: meta.title ?? "",
      active: true,
    }))

    if (insertRows.length > 0) {
      const { error: objectiveInsertError } = await supabase
        .from("lessons_learning_objective")
        .insert(insertRows)

      if (objectiveInsertError) {
        throw objectiveInsertError
      }
    }
  }

  revalidatePath(`/lessons/${payload.lessonId}`)
  revalidatePath(`/units/${payload.unitId}`)
}

const LessonObjectiveCreateInputSchema = z.object({
  lessonId: z.string().min(1),
  assessmentObjectiveId: z.string().min(1),
  title: z.string().trim().min(1).max(255),
  specRef: z.string().trim().max(255).optional(),
  successCriterionDescription: z.string().trim().min(1).max(500),
  successCriterionLevel: z.number().int().min(1).max(9),
})

const LessonSuccessCriterionCreateInputSchema = z.object({
  lessonId: z.string().min(1),
  learningObjectiveId: z.string().min(1),
  description: z.string().trim().min(1).max(500),
  level: z.number().int().min(1).max(9),
})

export async function createLessonLearningObjectiveAction(input: {
  lessonId: string
  assessmentObjectiveId: string
  title: string
  specRef?: string | null
  successCriterionDescription: string
  successCriterionLevel: number
}) {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  const payload = LessonObjectiveCreateInputSchema.parse({
    ...input,
    specRef: input.specRef ?? undefined,
  })

  return withTelemetry(
    {
      routeTag: `/lessons/${payload.lessonId}`,
      functionName: "createLessonLearningObjectiveAction",
      params: {
        lessonId: payload.lessonId,
        assessmentObjectiveId: payload.assessmentObjectiveId,
      },
      authEndTime,
    },
    async () => {
      const supabase = await createSupabaseServerClient()

      const { data: assessmentObjective, error: assessmentObjectiveError } = await supabase
        .from("assessment_objectives")
        .select("assessment_objective_id, curriculum_id, unit_id, code, title, order_index")
        .eq("assessment_objective_id", payload.assessmentObjectiveId)
        .maybeSingle()

      if (assessmentObjectiveError) {
        console.error(
          "[lessons] Failed to read assessment objective for lesson learning objective creation:",
          assessmentObjectiveError,
        )
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: assessmentObjectiveError.message,
        })
      }

      if (!assessmentObjective) {
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: "Assessment objective not found",
        })
      }

      const { data: maxOrderRow, error: maxOrderError } = await supabase
        .from("learning_objectives")
        .select("order_index")
        .eq("assessment_objective_id", payload.assessmentObjectiveId)
        .order("order_index", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()

      if (maxOrderError) {
        console.error("[lessons] Failed to read learning objective ordering:", maxOrderError)
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: maxOrderError.message,
        })
      }

      const nextOrder =
        typeof maxOrderRow?.order_index === "number" && Number.isFinite(maxOrderRow.order_index)
          ? maxOrderRow.order_index + 1
          : 0

      const specRef = payload.specRef?.trim()
      const normalizedSpecRef = specRef && specRef.length > 0 ? specRef : null

      const { data: insertedObjective, error: insertError } = await supabase
        .from("learning_objectives")
        .insert({
          assessment_objective_id: payload.assessmentObjectiveId,
          title: payload.title,
          order_index: nextOrder,
          active: true,
          spec_ref: normalizedSpecRef,
        })
        .select(
          "learning_objective_id, assessment_objective_id, title, order_index, active, spec_ref",
        )
        .single()

      if (insertError) {
        console.error("[lessons] Failed to create learning objective:", insertError)
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: insertError.message,
        })
      }

      let createdCriterion: {
        success_criteria_id: string
        learning_objective_id: string
        level: number
        description: string
        order_index: number | null
        active: boolean
        units: string[]
      } | null = null

      const { successCriterionDescription, successCriterionLevel } = payload

      const { data: insertedCriterion, error: insertCriterionError } = await supabase
        .from("success_criteria")
        .insert({
          learning_objective_id: insertedObjective.learning_objective_id,
          description: successCriterionDescription,
          level: successCriterionLevel,
          order_index: 0,
          active: true,
        })
        .select(
          "success_criteria_id, learning_objective_id, level, description, order_index, active",
        )
        .single()

      if (insertCriterionError) {
        console.error("[lessons] Failed to create default success criterion:", insertCriterionError)
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: insertCriterionError.message,
        })
      }

      createdCriterion = {
        success_criteria_id: insertedCriterion.success_criteria_id,
        learning_objective_id: insertedCriterion.learning_objective_id,
        level: insertedCriterion.level ?? successCriterionLevel,
        description: insertedCriterion.description ?? successCriterionDescription,
        order_index: insertedCriterion.order_index ?? 0,
        active: insertedCriterion.active ?? true,
        units: [],
      }

      const { error: lessonCriterionLinkError } = await supabase
        .from("lesson_success_criteria")
        .insert({
          lesson_id: payload.lessonId,
          success_criteria_id: createdCriterion.success_criteria_id,
        })

      if (lessonCriterionLinkError) {
        console.error(
          "[lessons] Failed to link success criterion to lesson:",
          lessonCriterionLinkError,
        )
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: lessonCriterionLinkError.message,
        })
      }

      const { data: lessonObjectiveOrders, error: lessonObjectiveOrdersError } = await supabase
        .from("lessons_learning_objective")
        .select("order_by")
        .eq("lesson_id", payload.lessonId)

      if (lessonObjectiveOrdersError) {
        console.error(
          "[lessons] Failed to read lesson learning objective ordering:",
          lessonObjectiveOrdersError,
        )
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: lessonObjectiveOrdersError.message,
        })
      }

      const nextLessonObjectiveOrder =
        (lessonObjectiveOrders ?? []).reduce<number>((max, row) => {
          const value = typeof row?.order_by === "number" ? row.order_by : -1
          return value > max ? value : max
        }, -1) + 1

      const { error: lessonObjectiveInsertError } = await supabase
        .from("lessons_learning_objective")
        .insert({
          lesson_id: payload.lessonId,
          learning_objective_id: insertedObjective.learning_objective_id,
          order_by: nextLessonObjectiveOrder,
          title: insertedObjective.title ?? payload.title,
          active: true,
        })

      if (lessonObjectiveInsertError) {
        console.error(
          "[lessons] Failed to link learning objective to lesson:",
          lessonObjectiveInsertError,
        )
        return LessonObjectiveMutationResultSchema.parse({
          data: null,
          error: lessonObjectiveInsertError.message,
        })
      }

      const normalizedObjective = {
        learning_objective_id: insertedObjective.learning_objective_id,
        assessment_objective_id: insertedObjective.assessment_objective_id,
        title: insertedObjective.title ?? payload.title,
        order_index: insertedObjective.order_index ?? nextOrder,
        active: insertedObjective.active ?? true,
        spec_ref: insertedObjective.spec_ref ?? normalizedSpecRef,
        assessment_objective_code: assessmentObjective.code ?? null,
        assessment_objective_title: assessmentObjective.title ?? null,
        assessment_objective_order_index: assessmentObjective.order_index ?? null,
        assessment_objective_curriculum_id: assessmentObjective.curriculum_id ?? null,
        assessment_objective_unit_id: assessmentObjective.unit_id ?? null,
        assessment_objective: {
          assessment_objective_id: assessmentObjective.assessment_objective_id,
          code: assessmentObjective.code ?? null,
          title: assessmentObjective.title ?? null,
          order_index: assessmentObjective.order_index ?? null,
          curriculum_id: assessmentObjective.curriculum_id ?? null,
          unit_id: assessmentObjective.unit_id ?? null,
        },
        success_criteria: createdCriterion ? [createdCriterion] : [],
      }

      revalidatePath(`/lessons/${payload.lessonId}`)
      if (assessmentObjective.curriculum_id) {
        revalidatePath(`/curriculum/${assessmentObjective.curriculum_id}`)
      }

      return LessonObjectiveMutationResultSchema.parse({
        data: normalizedObjective,
        error: null,
      })
    },
  )
}

export async function createLessonLearningObjectiveFormAction(
  _prevState: LessonObjectiveFormState,
  formData: FormData,
): Promise<LessonObjectiveFormState> {
  try {
    const lessonId = String(formData.get("lessonId") ?? "").trim()
    const assessmentObjectiveId = String(formData.get("assessmentObjectiveId") ?? "").trim()
    const title = String(formData.get("title") ?? "").trim()
    const specRefEntry = formData.get("specRef")
    const specRef =
      typeof specRefEntry === "string" && specRefEntry.trim().length > 0
        ? specRefEntry
        : null
    const successCriterionDescription = String(formData.get("successCriterionDescription") ?? "").trim()
    const successCriterionLevelValue = formData.get("successCriterionLevel")
    const successCriterionLevel =
      typeof successCriterionLevelValue === "string"
        ? Number.parseInt(successCriterionLevelValue, 10)
        : Number.NaN

    if (!lessonId || !assessmentObjectiveId || !title || successCriterionDescription.length === 0) {
      return {
        status: "error",
        message: "Lesson, assessment objective, title, and success criterion are required.",
        learningObjective: null,
      }
    }

    if (!Number.isInteger(successCriterionLevel) || successCriterionLevel < 1 || successCriterionLevel > 9) {
      return {
        status: "error",
        message: "Success criterion level must be between 1 and 9.",
        learningObjective: null,
      }
    }

    const result = await createLessonLearningObjectiveAction({
      lessonId,
      assessmentObjectiveId,
      title,
      specRef,
      successCriterionDescription,
      successCriterionLevel,
    })

    if (result.error || !result.data) {
      return {
        status: "error",
        message: result.error ?? "Unable to create learning objective.",
        learningObjective: null,
      }
    }

    return {
      status: "success",
      message: "Learning objective created.",
      learningObjective: result.data,
    }
  } catch (error) {
    console.error("[lessons] Failed to create learning objective via form:", error)
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to create learning objective.",
      learningObjective: null,
    }
  }
}

export async function createLessonSuccessCriterionAction(input: {
  lessonId: string
  learningObjectiveId: string
  description: string
  level: number
}) {
  await requireTeacherProfile()
  const authEndTime = performance.now()

  const payload = LessonSuccessCriterionCreateInputSchema.parse(input)

  return withTelemetry(
    {
      routeTag: `/lessons/${payload.lessonId}`,
      functionName: "createLessonSuccessCriterionAction",
      params: {
        lessonId: payload.lessonId,
        learningObjectiveId: payload.learningObjectiveId,
        level: payload.level,
      },
      authEndTime,
    },
    async () => {
      const supabase = await createSupabaseServerClient()

      const { data: learningObjective, error: learningObjectiveError } = await supabase
        .from("learning_objectives")
        .select(
          `learning_objective_id,
            assessment_objective_id,
            assessment_objective:assessment_objectives(
              curriculum_id,
              code,
              title,
              order_index
            )`,
        )
        .eq("learning_objective_id", payload.learningObjectiveId)
        .maybeSingle()

      if (learningObjectiveError) {
        console.error(
          "[lessons] Failed to read learning objective for success criterion creation:",
          learningObjectiveError,
        )
        return LessonSuccessCriterionMutationResultSchema.parse({
          data: null,
          error: learningObjectiveError.message,
        })
      }

      if (!learningObjective) {
        return LessonSuccessCriterionMutationResultSchema.parse({
          data: null,
          error: "Learning objective not found",
        })
      }

      const { data: maxOrderRow, error: maxOrderError } = await supabase
        .from("success_criteria")
        .select("order_index")
        .eq("learning_objective_id", payload.learningObjectiveId)
        .order("order_index", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()

      if (maxOrderError) {
        console.error("[lessons] Failed to read success criterion ordering:", maxOrderError)
        return LessonSuccessCriterionMutationResultSchema.parse({
          data: null,
          error: maxOrderError.message,
        })
      }

      const nextOrder =
        typeof maxOrderRow?.order_index === "number" && Number.isFinite(maxOrderRow.order_index)
          ? maxOrderRow.order_index + 1
          : 0

      const { data: insertedCriterion, error: insertError } = await supabase
        .from("success_criteria")
        .insert({
          learning_objective_id: payload.learningObjectiveId,
          description: payload.description,
          level: payload.level,
          order_index: nextOrder,
          active: true,
        })
        .select(
          "success_criteria_id, learning_objective_id, level, description, order_index, active",
        )
        .single()

      if (insertError) {
        console.error("[lessons] Failed to create success criterion:", insertError)
        return LessonSuccessCriterionMutationResultSchema.parse({
          data: null,
          error: insertError.message,
        })
      }

      const normalizedCriterion = {
        success_criteria_id: insertedCriterion.success_criteria_id,
        learning_objective_id: insertedCriterion.learning_objective_id,
        level: insertedCriterion.level ?? payload.level,
        description: insertedCriterion.description ?? payload.description,
        order_index: insertedCriterion.order_index ?? nextOrder,
        active: insertedCriterion.active ?? true,
        units: [],
      }

      revalidatePath(`/lessons/${payload.lessonId}`)

      const rawAssessmentObjective = learningObjective
        .assessment_objective as
        | { curriculum_id?: string | null }
        | Array<{ curriculum_id?: string | null }>
        | null
        | undefined
      const normalizedAssessmentObjective = Array.isArray(rawAssessmentObjective)
        ? rawAssessmentObjective[0] ?? null
        : rawAssessmentObjective ?? null
      const curriculumId = normalizedAssessmentObjective?.curriculum_id ?? null

      if (curriculumId) {
        revalidatePath(`/curriculum/${curriculumId}`)
      }

      return LessonSuccessCriterionMutationResultSchema.parse({
        data: normalizedCriterion,
        error: null,
      })
    },
  )
}

export async function createLessonSuccessCriterionFormAction(
  _prevState: LessonSuccessCriterionFormState,
  formData: FormData,
): Promise<LessonSuccessCriterionFormState> {
  try {
    const lessonId = String(formData.get("lessonId") ?? "").trim()
    const learningObjectiveId = String(formData.get("learningObjectiveId") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const levelValue = formData.get("level")

    const level = typeof levelValue === "string" ? Number.parseInt(levelValue, 10) : NaN

    if (!lessonId || !learningObjectiveId || !description) {
      return {
        status: "error",
        message: "Lesson, learning objective, and description are required.",
        successCriterion: null,
      }
    }

    if (!Number.isInteger(level) || level < 1 || level > 9) {
      return {
        status: "error",
        message: "Level must be a number between 1 and 9.",
        successCriterion: null,
      }
    }

    const result = await createLessonSuccessCriterionAction({
      lessonId,
      learningObjectiveId,
      description,
      level,
    })

    if (result.error || !result.data) {
      return {
        status: "error",
        message: result.error ?? "Unable to create success criterion.",
        successCriterion: null,
      }
    }

    return {
      status: "success",
      message: "Success criterion created.",
      successCriterion: result.data,
    }
  } catch (error) {
    console.error("[lessons] Failed to create success criterion via form:", error)
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to create success criterion.",
      successCriterion: null,
    }
  }
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

async function enrichLessonsWithSuccessCriteria<
  T extends { lesson_id?: string; lessons_learning_objective?: LessonLearningObjective[] },
>(lessons: T[]): Promise<{ lessons: T[]; error: string | null }> {
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
      spec_ref: string | null
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

  const activitySummativeFlags = new Map<string, boolean>()

  if (lessonIds.length > 0) {
    const { data: activityRows, error: activitiesError } = await supabase
      .from("activities")
      .select("activity_id, lesson_id, is_summative, type")
      .in("lesson_id", lessonIds)

    if (activitiesError) {
      return { lessons: [], error: activitiesError.message }
    }

    for (const row of activityRows ?? []) {
      const activityId = typeof row?.activity_id === "string" ? row.activity_id : null
      if (!activityId) continue
      const rawIsSummative =
        typeof (row as { is_summative?: unknown }).is_summative === "boolean"
          ? ((row as { is_summative?: unknown }).is_summative as boolean)
          : false
      const activityType =
        typeof (row as { type?: unknown }).type === "string"
          ? ((row as { type?: unknown }).type as string)
          : null
      activitySummativeFlags.set(activityId, rawIsSummative && isScorableActivityType(activityType))
    }
  }

  let lessonCriteriaRows: Array<{ lesson_id: string; success_criteria_id: string; activity_id: string | null }> = []

  if (lessonIds.length > 0) {
    const { data: rows, error: lessonCriteriaError } = await supabase
      .from("lesson_success_criteria")
      .select("lesson_id, success_criteria_id")
      .in("lesson_id", lessonIds)

    if (lessonCriteriaError) {
      return { lessons: [], error: lessonCriteriaError.message }
    }

    lessonCriteriaRows = (rows ?? []).filter(
      (row): row is { lesson_id: string; success_criteria_id: string; activity_id: string | null } =>
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
    Map<string, Array<{ success_criteria_id: string; learning_objective_id: string | null; activity_id: string | null }>>
  >(
    (acc, row) => {
      const list = acc.get(row.lesson_id) ?? []
      const details = detailMap.get(row.success_criteria_id)
      list.push({
        success_criteria_id: row.success_criteria_id,
        learning_objective_id: details?.learning_objective_id ?? null,
        activity_id: typeof row.activity_id === "string" ? row.activity_id : null,
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
        "learning_objective_id, title, assessment_objective_id, order_index, active, spec_ref, assessment_objective:assessment_objectives(code, title, order_index)"
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
        spec_ref: typeof row.spec_ref === "string" ? row.spec_ref : null,
      })
    }
  }

  const enriched = lessons.map((lesson) => {
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
            spec_ref: metadata?.spec_ref ?? entry.learning_objective?.spec_ref ?? null,
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
      updatedObjectives
        .map((objective) => {
          const direct = (objective as { learning_objective_id?: string | null }).learning_objective_id
          if (typeof direct === "string" && direct.length > 0) {
            return direct
          }
          const nested = (objective as {
            learning_objective?: { learning_objective_id?: string | null }
          }).learning_objective?.learning_objective_id
          return typeof nested === "string" && nested.length > 0 ? nested : null
        })
        .filter((id): id is string => Boolean(id && id.length > 0)),
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
        activity_id: row.activity_id,
        is_summative: row.activity_id ? activitySummativeFlags.get(row.activity_id) ?? false : false,
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
        spec_ref: null,
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
          spec_ref: metadata.spec_ref ?? null,
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

async function loadLessonDetailBootstrapPayload(
  lessonId: string,
): Promise<z.infer<typeof LessonDetailReturnValue>> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc("lesson_detail_bootstrap", { p_lesson_id: lessonId })

  if (error) {
    console.error("[lessons] Failed to load lesson detail bootstrap RPC:", error)
    return LessonDetailReturnValue.parse({ data: null, error: error.message })
  }

  const parsed = LessonDetailPayloadSchema.safeParse(data)

  if (!parsed.success) {
    console.error("[lessons] Invalid lesson detail payload:", parsed.error)
    return LessonDetailReturnValue.parse({ data: null, error: "Unable to parse lesson detail payload" })
  }

  return LessonDetailReturnValue.parse({ data: parsed.data, error: null })
}

async function loadLessonReferencePayload(
  lessonId: string,
): Promise<z.infer<typeof LessonReferenceReturnValue>> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc("lesson_reference_bootstrap", { p_lesson_id: lessonId })

  if (error) {
    console.error("[lessons] Failed to load lesson reference payload:", error)
    return LessonReferenceReturnValue.parse({ data: null, error: error.message })
  }

  const parsed = LessonReferencePayloadSchema.safeParse(data)

  if (!parsed.success) {
    console.error("[lessons] Invalid lesson reference payload:", parsed.error)
    return LessonReferenceReturnValue.parse({ data: null, error: "Unable to parse lesson reference payload" })
  }

  return LessonReferenceReturnValue.parse({ data: parsed.data, error: null })
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

export async function readLessonAction(
  lessonId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/lessons:readLesson"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLessonAction",
      params: { lessonId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for lesson read:", { lessonId })
      const payload = await loadLessonDetailBootstrapPayload(lessonId)

      if (payload.error) {
        return LessonReturnValue.parse({ data: null, error: payload.error })
      }

      return LessonReturnValue.parse({ data: payload.data?.lesson ?? null, error: null })
    },
  )
}

export async function readLessonDetailBootstrapAction(
  lessonId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/lessons:detailBootstrap"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLessonDetailBootstrapAction",
      params: { lessonId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[lessons] Server action started for lesson detail bootstrap:", { lessonId })
      return loadLessonDetailBootstrapPayload(lessonId)
    },
  )
}

export async function readLessonReferenceDataAction(
  lessonId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/lessons:referenceData"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLessonReferenceDataAction",
      params: { lessonId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[lessons] Server action started for lesson reference payload:", { lessonId })
      return loadLessonReferencePayload(lessonId)
    },
  )
}
