"use server"

import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import { revalidatePath } from "next/cache"
import { z } from "zod"

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
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { type NormalizedSuccessCriterion } from "./learning-objectives"
import { isScorableActivityType } from "@/dino.config"
import { requireTeacherProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
import { LESSON_CHANNEL_NAME, LESSON_CREATED_EVENT } from "@/lib/lesson-channel"
import { enqueueLessonMutationJob } from "@/lib/lesson-job-runner"
import { LessonDetailPayloadSchema } from "@/lib/lesson-snapshot-schema"
import { Client } from "pg"
import { query, withDbClient } from "@/lib/db"

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

const LessonUpdateReturnValue = z.object({
  data: LessonWithObjectivesSchema.nullable(),
  error: z.string().nullable(),
})

const LessonHeaderUpdateStateSchema = z.object({
  status: z.enum(["idle", "success", "error"]),
  message: z.string().nullable(),
  lesson: LessonWithObjectivesSchema.nullable(),
})

export type LessonHeaderUpdateState = z.infer<typeof LessonHeaderUpdateStateSchema>

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

function resolvePgConnectionString() {
  return process.env.POSTSQL_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? null
}

function createPgClient() {
  const connectionString = resolvePgConnectionString()
  if (!connectionString) {
    throw new Error("Database connection is not configured (POSTSQL_URL or SUPABASE_DB_URL missing).")
  }

  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

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
    let lessonId: string | null = null
    let orderValue = 0

    await withDbClient(async (client) => {
      const { rows: maxOrderRows } = await client.query(
        "select order_by from lessons where unit_id = $1 order by order_by desc nulls last limit 1",
        [unitId],
      )
      orderValue = (maxOrderRows?.[0]?.order_by ?? -1) + 1

      const { rows: inserted } = await client.query(
        `
          insert into lessons (unit_id, title, active, order_by)
          values ($1, $2, true, $3)
          returning lesson_id, order_by
        `,
        [unitId, title, orderValue],
      )

      const row = inserted?.[0] ?? null
      if (!row?.lesson_id) {
        throw new Error("Unable to create lesson.")
      }
      lessonId = row.lesson_id
      orderValue = row.order_by ?? orderValue
    })

    if (!lessonId) {
      throw new Error("Unable to create lesson.")
    }

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
        order_by: orderValue,
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

      let lessons: Array<Record<string, unknown>> = []
      try {
        const { rows } = await query(
          `
            select l.*,
                   json_agg(ll.*) filter (where ll.lesson_id is not null) as lessons_learning_objective,
                   json_agg(links.*) filter (where links.lesson_id is not null) as lesson_links
            from lessons l
            left join lessons_learning_objective ll on ll.lesson_id = l.lesson_id
            left join lesson_links links on links.lesson_id = l.lesson_id
            where l.unit_id = $1
            group by l.lesson_id
            order by l.order_by asc, l.title asc
          `,
          [unitId],
        )
        lessons = rows ?? []
      } catch (error) {
        console.error("[v0] Failed to read lessons via PG:", error)
        const message = error instanceof Error ? error.message : "Unable to load lessons."
        return LessonsReturnValue.parse({ data: null, error: message })
      }

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

      let lessons: Array<Record<string, unknown>> = []
      try {
        const { rows } = await query(
          `
            select l.*,
                   json_agg(ll.*) filter (where ll.lesson_id is not null) as lessons_learning_objective,
                   json_agg(links.*) filter (where links.lesson_id is not null) as lesson_links
            from lessons l
            left join lessons_learning_objective ll on ll.lesson_id = l.lesson_id
            left join lesson_links links on links.lesson_id = l.lesson_id
            group by l.lesson_id
            order by l.unit_id asc, l.order_by asc nulls first, l.title asc
          `,
        )
        lessons = rows ?? []
      } catch (error) {
        console.error("[v0] Failed to read all lessons via PG:", error)
        const message = error instanceof Error ? error.message : "Unable to load lessons."
        return LessonsReturnValue.parse({ data: null, error: message })
      }

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

  let createdLessonId: string | null = null

  try {
    await withDbClient(async (client) => {
      const { rows: maxOrderRows } = await client.query(
        "select order_by from lessons where unit_id = $1 order by order_by desc nulls last limit 1",
        [unitId],
      )
      const nextOrder = (maxOrderRows?.[0]?.order_by ?? -1) + 1

      const { rows: insertedLesson } = await client.query(
        `
          insert into lessons (unit_id, title, active, order_by)
          values ($1, $2, true, $3)
          returning *
        `,
        [unitId, title, nextOrder],
      )

      const lessonRow = insertedLesson?.[0] ?? null
      if (!lessonRow?.lesson_id) {
        throw new Error("Unable to create lesson.")
      }
      createdLessonId = lessonRow.lesson_id

      if (sanitizedObjectiveIds.length > 0) {
        const values: unknown[] = []
        const placeholders: string[] = []
        sanitizedObjectiveIds.forEach((learningObjectiveId, index) => {
          values.push(learningObjectiveId, createdLessonId, index, title)
          placeholders.push(
            `($${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length})`,
          )
        })

        await client.query(
          `
            insert into lessons_learning_objective (learning_objective_id, lesson_id, order_by, title, active)
            values ${placeholders.join(", ")}
          `,
          values,
        )
      }
    })
  } catch (error) {
    console.error("[v0] Failed to create lesson via PG:", error)
    const message = error instanceof Error ? error.message : "Unable to create lesson."
    return LessonReturnValue.parse({ data: null, error: message })
  }

  if (!createdLessonId) {
    return LessonReturnValue.parse({ data: null, error: "Unable to create lesson." })
  }

  revalidatePath(`/units/${unitId}`)
  return readLessonWithObjectives(createdLessonId)
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

  try {
    await withDbClient(async (client) => {
      await client.query("update lessons set title = $1 where lesson_id = $2", [title, lessonId])

      const { rows: existingLinks } = await client.query(
        "select learning_objective_id from lessons_learning_objective where lesson_id = $1",
        [lessonId],
      )

      const existingIds = new Set((existingLinks ?? []).map((link) => link.learning_objective_id))
      const incomingIds = new Set(sanitizedObjectiveIds)

      const idsToDelete = Array.from(existingIds).filter((id) => !incomingIds.has(id))
      const idsToInsert = sanitizedObjectiveIds.filter((id) => !existingIds.has(id))

      for (const [index, learningObjectiveId] of sanitizedObjectiveIds.entries()) {
        if (existingIds.has(learningObjectiveId)) {
          await client.query(
            `
              update lessons_learning_objective
              set order_by = $1, active = true
              where lesson_id = $2 and learning_objective_id = $3
            `,
            [index, lessonId, learningObjectiveId],
          )
        }
      }

      if (idsToDelete.length > 0) {
        await client.query(
          `
            delete from lessons_learning_objective
            where lesson_id = $1 and learning_objective_id = any($2::text[])
          `,
          [lessonId, idsToDelete],
        )
      }

      if (idsToInsert.length > 0) {
        const values: unknown[] = []
        const placeholders: string[] = []
        idsToInsert.forEach((learningObjectiveId) => {
          values.push(learningObjectiveId, lessonId, sanitizedObjectiveIds.indexOf(learningObjectiveId), title)
          placeholders.push(
            `($${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length})`,
          )
        })

        await client.query(
          `
            insert into lessons_learning_objective (learning_objective_id, lesson_id, order_by, title, active)
            values ${placeholders.join(", ")}
          `,
          values,
        )
      }
    })
  } catch (error) {
    console.error("[v0] Failed to update lesson via PG:", error)
    const message = error instanceof Error ? error.message : "Unable to update lesson."
    return LessonReturnValue.parse({ data: null, error: message })
  }

  revalidatePath(`/units/${unitId}`)
  return readLessonWithObjectives(lessonId)
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
    executor: async () => {
      await applyLessonSuccessCriteriaUpdate(payload)
    },
  })
}

async function applyLessonSuccessCriteriaUpdate(payload: z.infer<typeof LessonSuccessCriteriaUpdateSchema>) {
  const normalizedIds = Array.from(new Set(payload.successCriteriaIds))

  await withDbClient(async (client) => {
    const { rows: existingCriteriaLinks } = await client.query(
      "select success_criteria_id from lesson_success_criteria where lesson_id = $1",
      [payload.lessonId],
    )

    const existingCriteriaIds = new Set(
      (existingCriteriaLinks ?? [])
        .map((link) => link.success_criteria_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    )

    const idsToInsert = normalizedIds.filter((id) => !existingCriteriaIds.has(id))
    const idsToDelete = Array.from(existingCriteriaIds).filter((id) => !normalizedIds.includes(id))

    if (idsToInsert.length > 0) {
      const values: unknown[] = []
      const placeholders: string[] = []
      idsToInsert.forEach((id) => {
        values.push(payload.lessonId, id)
        placeholders.push(`($${values.length - 1}, $${values.length})`)
      })
      await client.query(
        `
          insert into lesson_success_criteria (lesson_id, success_criteria_id)
          values ${placeholders.join(", ")}
        `,
        values,
      )
    }

    if (idsToDelete.length > 0) {
      await client.query(
        `
          delete from lesson_success_criteria
          where lesson_id = $1
            and success_criteria_id = any($2::text[])
        `,
        [payload.lessonId, idsToDelete],
      )
    }

    let learningObjectiveIdsFromSelection: string[] = []

    if (normalizedIds.length > 0) {
      const { rows: criteriaMetadata } = await client.query(
        `
          select success_criteria_id, learning_objective_id
          from success_criteria
          where success_criteria_id = any($1::text[])
        `,
        [normalizedIds],
      )

      learningObjectiveIdsFromSelection = Array.from(
        new Set(
          (criteriaMetadata ?? [])
            .map((row) => row.learning_objective_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      )
    }

    const { rows: existingObjectiveLinks } = await client.query(
      "select learning_objective_id, order_by from lessons_learning_objective where lesson_id = $1",
      [payload.lessonId],
    )

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
      await client.query(
        `
          delete from lessons_learning_objective
          where lesson_id = $1
            and learning_objective_id = any($2::text[])
        `,
        [payload.lessonId, objectiveIdsToRemove],
      )
    }

    if (objectiveIdsToInsert.length > 0) {
      const { rows: learningObjectiveMetadata } = await client.query(
        `
          select learning_objective_id, title
          from learning_objectives
          where learning_objective_id = any($1::text[])
        `,
        [objectiveIdsToInsert],
      )

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
        const values: unknown[] = []
        const placeholders: string[] = []
        insertRows.forEach((row) => {
          values.push(row.lesson_id, row.learning_objective_id, row.order_by, row.title, row.active)
          placeholders.push(
            `($${values.length - 4}, $${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length})`,
          )
        })

        await client.query(
          `
            insert into lessons_learning_objective (lesson_id, learning_objective_id, order_by, title, active)
            values ${placeholders.join(", ")}
          `,
          values,
        )
      }
    }
  })

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
      let assessmentObjective:
        | {
            assessment_objective_id: string
            curriculum_id: string | null
            unit_id: string | null
            code: string | null
            title: string | null
            order_index: number | null
          }
        | null = null
      let insertedObjective:
        | {
            learning_objective_id: string
            assessment_objective_id: string | null
            title: string | null
            order_index: number | null
            active: boolean | null
            spec_ref: string | null
          }
        | null = null
      let createdCriterion:
        | {
            success_criteria_id: string
            learning_objective_id: string
            level: number
            description: string
            order_index: number | null
            active: boolean
            units: string[]
          }
        | null = null

      const specRef = payload.specRef?.trim()
      const normalizedSpecRef = specRef && specRef.length > 0 ? specRef : null
      let nextOrder = 0

      try {
        await withDbClient(async (client) => {
          const { rows: aoRows } = await client.query(
            `
              select assessment_objective_id, curriculum_id, unit_id, code, title, order_index
              from assessment_objectives
              where assessment_objective_id = $1
              limit 1
            `,
            [payload.assessmentObjectiveId],
          )
          assessmentObjective = aoRows?.[0] ?? null

          if (!assessmentObjective) {
            throw new Error("Assessment objective not found")
          }

          const { rows: maxOrderRow } = await client.query(
            `
              select order_index
              from learning_objectives
              where assessment_objective_id = $1
              order by order_index desc nulls last
              limit 1
            `,
            [payload.assessmentObjectiveId],
          )

          nextOrder =
            typeof maxOrderRow?.[0]?.order_index === "number" && Number.isFinite(maxOrderRow[0].order_index)
              ? maxOrderRow[0].order_index + 1
              : 0

          const { rows: insertedObjectiveRows } = await client.query(
            `
              insert into learning_objectives (assessment_objective_id, title, order_index, active, spec_ref)
              values ($1, $2, $3, true, $4)
              returning learning_objective_id, assessment_objective_id, title, order_index, active, spec_ref
            `,
            [payload.assessmentObjectiveId, payload.title, nextOrder, normalizedSpecRef],
          )

          insertedObjective = insertedObjectiveRows?.[0] ?? null
          if (!insertedObjective) {
            throw new Error("Unable to create learning objective.")
          }

          const { successCriterionDescription, successCriterionLevel } = payload

          const { rows: insertedCriteriaRows } = await client.query(
            `
              insert into success_criteria (learning_objective_id, description, level, order_index, active)
              values ($1, $2, $3, 0, true)
              returning success_criteria_id, learning_objective_id, level, description, order_index, active
            `,
            [insertedObjective.learning_objective_id, successCriterionDescription, successCriterionLevel],
          )

          const insertedCriterion = insertedCriteriaRows?.[0] ?? null
          if (!insertedCriterion) {
            throw new Error("Unable to create success criterion.")
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

          await client.query(
            `
              insert into lesson_success_criteria (lesson_id, success_criteria_id)
              values ($1, $2)
            `,
            [payload.lessonId, createdCriterion.success_criteria_id],
          )

          const { rows: lessonObjectiveOrders } = await client.query(
            "select order_by from lessons_learning_objective where lesson_id = $1",
            [payload.lessonId],
          )

          const nextLessonObjectiveOrder =
            (lessonObjectiveOrders ?? []).reduce<number>((max, row) => {
              const value = typeof row?.order_by === "number" ? row.order_by : -1
              return value > max ? value : max
            }, -1) + 1

          await client.query(
            `
              insert into lessons_learning_objective (lesson_id, learning_objective_id, order_by, title, active)
              values ($1, $2, $3, $4, true)
            `,
            [
              payload.lessonId,
              insertedObjective.learning_objective_id,
              nextLessonObjectiveOrder,
              insertedObjective.title ?? payload.title,
            ],
          )
        })
      } catch (error) {
    console.error("[lessons] Failed to create learning objective via PG:", error)
    const message = error instanceof Error ? error.message : "Unable to create learning objective."
    return LessonObjectiveMutationResultSchema.parse({ data: null, error: message })
  }

  if (!insertedObjective || !assessmentObjective) {
    return LessonObjectiveMutationResultSchema.parse({
      data: null,
      error: "Unable to create learning objective.",
    })
  }

  const assessmentObjectiveRecord = assessmentObjective as {
    assessment_objective_id?: string | null
    code?: string | null
    title?: string | null
    order_index?: number | null
    curriculum_id?: string | null
    unit_id?: string | null
  }

  const objectiveRecord = insertedObjective as {
    learning_objective_id: string
    assessment_objective_id: string
    title?: string | null
    order_index?: number | null
    active?: boolean | null
    spec_ref?: string | null
  }

  const normalizedObjective = {
    learning_objective_id: objectiveRecord.learning_objective_id,
    assessment_objective_id:
      assessmentObjectiveRecord.assessment_objective_id ?? objectiveRecord.assessment_objective_id,
    title: objectiveRecord.title ?? payload.title,
    order_index: objectiveRecord.order_index ?? nextOrder,
    active: objectiveRecord.active ?? true,
    spec_ref: objectiveRecord.spec_ref ?? normalizedSpecRef,
    assessment_objective_code: assessmentObjectiveRecord.code ?? null,
    assessment_objective_title: assessmentObjectiveRecord.title ?? null,
    assessment_objective_order_index: assessmentObjectiveRecord.order_index ?? null,
    assessment_objective_curriculum_id: assessmentObjectiveRecord.curriculum_id ?? null,
    assessment_objective_unit_id: assessmentObjectiveRecord.unit_id ?? null,
    assessment_objective: {
      assessment_objective_id:
        assessmentObjectiveRecord.assessment_objective_id ?? objectiveRecord.assessment_objective_id,
      code: assessmentObjectiveRecord.code ?? null,
      title: assessmentObjectiveRecord.title ?? null,
      order_index: assessmentObjectiveRecord.order_index ?? null,
      curriculum_id: assessmentObjectiveRecord.curriculum_id ?? null,
      unit_id: assessmentObjectiveRecord.unit_id ?? null,
    },
    success_criteria: createdCriterion ? [createdCriterion] : [],
  }

  revalidatePath(`/lessons/${payload.lessonId}`)
  if (assessmentObjectiveRecord.curriculum_id) {
    revalidatePath(`/curriculum/${assessmentObjectiveRecord.curriculum_id}`)
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
      let learningObjective: {
        learning_objective_id: string
        assessment_objective_id: string | null
        assessment_objective?: { curriculum_id?: string | null; code?: string | null; title?: string | null; order_index?: number | null } | null
      } | null = null
      let insertedCriterion: {
        success_criteria_id: string
        learning_objective_id: string
        level: number | null
        description: string | null
        order_index: number | null
        active: boolean | null
      } | null = null
      let nextOrder = 0

      try {
        await withDbClient(async (client) => {
          const { rows: loRows } = await client.query(
            `
              select lo.learning_objective_id,
                     lo.assessment_objective_id,
                     ao.curriculum_id,
                     ao.code,
                     ao.title,
                     ao.order_index
              from learning_objectives lo
              left join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
              where lo.learning_objective_id = $1
              limit 1
            `,
            [payload.learningObjectiveId],
          )
          learningObjective = loRows?.[0] ?? null

          if (!learningObjective) {
            throw new Error("Learning objective not found")
          }

          const { rows: maxOrderRow } = await client.query(
            `
              select order_index
              from success_criteria
              where learning_objective_id = $1
              order by order_index desc nulls last
              limit 1
            `,
            [payload.learningObjectiveId],
          )

          nextOrder =
            typeof maxOrderRow?.[0]?.order_index === "number" && Number.isFinite(maxOrderRow[0].order_index)
              ? maxOrderRow[0].order_index + 1
              : 0

          const { rows: insertedRows } = await client.query(
            `
              insert into success_criteria (learning_objective_id, description, level, order_index, active)
              values ($1, $2, $3, $4, true)
              returning success_criteria_id, learning_objective_id, level, description, order_index, active
            `,
            [payload.learningObjectiveId, payload.description, payload.level, nextOrder],
          )

          insertedCriterion = insertedRows?.[0] ?? null
          if (!insertedCriterion) {
            throw new Error("Unable to create success criterion.")
          }
        })
      } catch (error) {
        console.error("[lessons] Failed to create success criterion via PG:", error)
        const message = error instanceof Error ? error.message : "Unable to create success criterion."
        return LessonSuccessCriterionMutationResultSchema.parse({ data: null, error: message })
      }

      if (!insertedCriterion) {
        return LessonSuccessCriterionMutationResultSchema.parse({
          data: null,
          error: "Unable to create success criterion.",
        })
      }

      const criterionRecord = insertedCriterion as {
        success_criteria_id: string
        learning_objective_id: string | null
        level?: number | null
        description?: string | null
        order_index?: number | null
        active?: boolean | null
      }

      const normalizedCriterion = {
        success_criteria_id: criterionRecord.success_criteria_id,
        learning_objective_id: criterionRecord.learning_objective_id,
        level: criterionRecord.level ?? payload.level,
        description: criterionRecord.description ?? payload.description,
        order_index: criterionRecord.order_index ?? nextOrder,
        active: criterionRecord.active ?? true,
        units: [],
      }

      revalidatePath(`/lessons/${payload.lessonId}`)

      const learningObjectiveRecord = learningObjective as
        | { assessment_objective?: { curriculum_id?: string | null } | null }
        | null
      const rawAssessmentObjective = learningObjectiveRecord?.assessment_objective ?? null
      const normalizedAssessmentObjective = rawAssessmentObjective ?? null
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

  try {
    await query("update lessons set active = false where lesson_id = $1", [lessonId])
  } catch (error) {
    console.error("[v0] Failed to deactivate lesson:", error)
    const message = error instanceof Error ? error.message : "Unable to deactivate lesson."
    return { success: false, error: message }
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

  try {
    await withDbClient(async (client) => {
      for (const update of updates) {
        await client.query("update lessons set order_by = $1 where lesson_id = $2", [
          update.orderBy,
          update.lessonId,
        ])
      }
    })
  } catch (error) {
    console.error("[v0] Failed to reorder lesson:", error)
    const message = error instanceof Error ? error.message : "Unable to reorder lessons."
    return { success: false, error: message }
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
    try {
      const { rows: activityRows } = await query(
        "select activity_id, lesson_id, is_summative, type from activities where lesson_id = any($1::text[])",
        [lessonIds],
      )

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
    } catch (activitiesError) {
      console.error("[lessons] Failed to load activities for enrichment:", activitiesError)
      return { lessons: [], error: "Unable to load activity metadata." }
    }
  }

  let lessonCriteriaRows: Array<{ lesson_id: string; success_criteria_id: string; activity_id: string | null }> = []

  if (lessonIds.length > 0) {
    try {
      const { rows } = await query<{
        lesson_id: string
        success_criteria_id: string
      }>("select lesson_id, success_criteria_id from lesson_success_criteria where lesson_id = any($1::text[])", [
        lessonIds,
      ])

      lessonCriteriaRows = (rows ?? []).filter(
        (row): row is { lesson_id: string; success_criteria_id: string; activity_id: string | null } =>
          typeof row?.lesson_id === "string" && typeof row?.success_criteria_id === "string",
      )
      lessonCriteriaRows = lessonCriteriaRows.map((row) => ({ ...row, activity_id: null }))
    } catch (lessonCriteriaError) {
      console.error("[lessons] Failed to load lesson success criteria:", lessonCriteriaError)
      return { lessons: [], error: "Unable to load lesson success criteria." }
    }

    const missingIds = Array.from(
      new Set(
        lessonCriteriaRows
          .map((row) => row.success_criteria_id)
          .filter((id) => id && !detailMap.has(id)),
      ),
    )

    if (missingIds.length > 0) {
      try {
        const { rows: missingRows } = await query(
          `
            select success_criteria_id, description, level, learning_objective_id
            from success_criteria
            where success_criteria_id = any($1::text[])
          `,
          [missingIds],
        )

        for (const row of missingRows ?? []) {
          const successCriteriaId = typeof row?.success_criteria_id === "string" ? row.success_criteria_id : null
          if (!successCriteriaId) continue
          const description = typeof row.description === "string" ? row.description : null
          const level = typeof row.level === "number" ? row.level : null
          const learningObjectiveId =
            typeof row.learning_objective_id === "string" ? row.learning_objective_id : null

          detailMap.set(successCriteriaId, {
            description,
            level,
            learning_objective_id: learningObjectiveId,
          })

          if (learningObjectiveId) {
            const normalized: NormalizedSuccessCriterion = {
              success_criteria_id: successCriteriaId,
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
      } catch (missingError) {
        console.error("[lessons] Failed to load missing success criteria:", missingError)
        return { lessons: [], error: "Unable to load success criteria metadata." }
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
    try {
      const { rows } = await query(
        `
          select success_criteria_id, learning_objective_id, description, level
          from success_criteria
          where success_criteria_id = any($1::text[])
        `,
        [
          Array.from(new Set(lessonCriteriaRows.map((row) => row.success_criteria_id))).filter(
            (id) => Boolean(id),
          ),
        ],
      )
      criteriaMetadataRows = (rows ?? [])
        .filter((row) => typeof row?.success_criteria_id === "string")
        .map((row) => ({
          success_criteria_id: row.success_criteria_id as string,
          learning_objective_id: typeof row.learning_objective_id === "string" ? row.learning_objective_id : null,
          description: typeof row.description === "string" ? row.description : null,
          level: typeof row.level === "number" ? row.level : null,
        }))
    } catch (criteriaMetadataError) {
      console.error("[lessons] Failed to load success criteria metadata:", criteriaMetadataError)
      return { lessons: [], error: "Unable to load success criteria metadata." }
    }
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
    try {
      const { rows: learningObjectiveRows } = await query(
        `
          select lo.learning_objective_id,
                 lo.title,
                 lo.assessment_objective_id,
                 lo.order_index,
                 lo.active,
                 lo.spec_ref,
                 ao.code as assessment_objective_code,
                 ao.title as assessment_objective_title,
                 ao.order_index as assessment_objective_order_index
          from learning_objectives lo
          left join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
          where lo.learning_objective_id = any($1::text[])
        `,
        [metadataIdsToFetch],
      )

      for (const row of learningObjectiveRows ?? []) {
        const learningObjectiveId =
          typeof row?.learning_objective_id === "string" ? row.learning_objective_id : null
        if (!learningObjectiveId) continue
        learningObjectiveMetadata.set(learningObjectiveId, {
          title: typeof row.title === "string" ? row.title : null,
          assessment_objective_id:
            typeof row.assessment_objective_id === "string" ? row.assessment_objective_id : null,
          assessment_objective_title:
            typeof row.assessment_objective_title === "string" ? row.assessment_objective_title : null,
          assessment_objective_code:
            typeof row.assessment_objective_code === "string" ? row.assessment_objective_code : null,
          assessment_objective_order_index:
            typeof row.assessment_objective_order_index === "number"
              ? row.assessment_objective_order_index
              : null,
          order_index: typeof row.order_index === "number" ? row.order_index : null,
          active: typeof row.active === "boolean" ? row.active : null,
          spec_ref: typeof row.spec_ref === "string" ? row.spec_ref : null,
        })
      }
    } catch (learningObjectiveError) {
      console.error("[lessons] Failed to load learning objective metadata:", learningObjectiveError)
      return { lessons: [], error: "Unable to load learning objectives." }
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
  let client: Client | null = null
  try {
    client = createPgClient()
    await client.connect()
    const { rows } = await client.query("select lesson_detail_bootstrap($1) as payload", [lessonId])
    const payload = rows[0]?.payload ?? null
    const parsed = LessonDetailPayloadSchema.safeParse(payload)

    if (!parsed.success) {
      console.error("[lessons] Invalid lesson detail payload:", parsed.error)
      return LessonDetailReturnValue.parse({ data: null, error: "Unable to parse lesson detail payload" })
    }

    return LessonDetailReturnValue.parse({ data: parsed.data, error: null })
  } catch (error) {
    console.error("[lessons] Failed to load lesson detail bootstrap via PG:", error)
    const message = error instanceof Error ? error.message : "Unable to load lesson detail."
    return LessonDetailReturnValue.parse({ data: null, error: message })
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        // ignore close errors
      }
    }
  }
}

async function loadLessonReferencePayload(
  lessonId: string,
): Promise<z.infer<typeof LessonReferenceReturnValue>> {
  let client: Client | null = null
  try {
    client = createPgClient()
    await client.connect()
    const { rows } = await client.query("select lesson_reference_bootstrap($1) as payload", [lessonId])
    const payload = rows[0]?.payload ?? null
    const parsed = LessonReferencePayloadSchema.safeParse(payload)

    if (!parsed.success) {
      console.error("[lessons] Invalid lesson reference payload:", parsed.error)
      return LessonReferenceReturnValue.parse({
        data: null,
        error: "Unable to parse lesson reference payload",
      })
    }

    return LessonReferenceReturnValue.parse({ data: parsed.data, error: null })
  } catch (error) {
    console.error("[lessons] Failed to load lesson reference payload via PG:", error)
    const message = error instanceof Error ? error.message : "Unable to load lesson reference payload."
    return LessonReferenceReturnValue.parse({ data: null, error: message })
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        // ignore close errors
      }
    }
  }
}

const LessonHeaderUpdateInputSchema = z.object({
  lessonId: z.string(),
  title: z.string().trim().min(1).max(255),
  active: z.boolean(),
})

export async function updateLessonHeaderMutation(
  input: z.infer<typeof LessonHeaderUpdateInputSchema>,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const payload = LessonHeaderUpdateInputSchema.parse(input)
  const profile = await requireTeacherProfile()
  const authEndTime = options?.authEndTime ?? performance.now()
  const routeTag = options?.routeTag ?? "/lessons:updateHeader"

  return withTelemetry(
    {
      routeTag,
      functionName: "updateLessonHeaderMutation",
      params: { lessonId: payload.lessonId, active: payload.active, hasTitle: payload.title.length > 0 },
      authEndTime,
    },
    async () => {
      let client: Client | null = null
      try {
        client = createPgClient()
        await client.connect()
        const result = await client.query(
          `update lessons
            set title = $1, active = $2
            where lesson_id = $3
            returning lesson_id, unit_id, title, active, order_by`,
          [payload.title, payload.active, payload.lessonId],
        )

        if (result.rowCount === 0) {
          return LessonUpdateReturnValue.parse({ data: null, error: "Lesson not found." })
        }
      } catch (error) {
        console.error("[lessons] Failed to update lesson header via PG:", error, {
          lessonId: payload.lessonId,
          userId: profile.userId,
        })
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message?: string }).message ?? "Unable to update lesson header.")
            : "Unable to update lesson header."
        return LessonUpdateReturnValue.parse({ data: null, error: message })
      } finally {
        if (client) {
          await client.end()
        }
      }

      const refreshed = await loadLessonDetailBootstrapPayload(payload.lessonId)
      if (refreshed.error || !refreshed.data?.lesson) {
        return LessonUpdateReturnValue.parse({
          data: null,
          error: refreshed.error ?? "Unable to load updated lesson.",
        })
      }

      revalidatePath(`/lessons/${payload.lessonId}`)
      return LessonUpdateReturnValue.parse({ data: refreshed.data.lesson, error: null })
    },
  )
}

export async function updateLessonHeaderAction(
  _prevState: LessonHeaderUpdateState,
  formData: FormData,
): Promise<LessonHeaderUpdateState> {
  const lessonId = String(formData.get("lessonId") ?? "").trim()
  const title = String(formData.get("title") ?? "").trim()
  const activeValue = formData.get("active")
  const active =
    typeof activeValue === "string" &&
    ["true", "1", "on", "checked"].includes(activeValue.toLowerCase())

  if (!lessonId || !title) {
    return LessonHeaderUpdateStateSchema.parse({
      status: "error",
      message: "Lesson id and title are required.",
      lesson: null,
    })
  }

  const result = await updateLessonHeaderMutation({ lessonId, title, active })

  if (result.error || !result.data) {
    return LessonHeaderUpdateStateSchema.parse({
      status: "error",
      message: result.error ?? "Unable to update lesson.",
      lesson: null,
    })
  }

  return LessonHeaderUpdateStateSchema.parse({
    status: "success",
    message: "Lesson updated.",
    lesson: result.data,
  })
}

async function readLessonWithObjectives(lessonId: string) {
  let lesson: Record<string, unknown> | null = null
  try {
    const { rows } = await query(
      `
        select l.*,
               json_agg(ll.*) filter (where ll.lesson_id is not null) as lessons_learning_objective,
               json_agg(links.*) filter (where links.lesson_id is not null) as lesson_links
        from lessons l
        left join lessons_learning_objective ll on ll.lesson_id = l.lesson_id
        left join lesson_links links on links.lesson_id = l.lesson_id
        where l.lesson_id = $1
        group by l.lesson_id
        limit 1
      `,
      [lessonId],
    )
    lesson = rows?.[0] ?? null
  } catch (error) {
    console.error("[v0] Failed to read lesson via PG:", error)
    const message = error instanceof Error ? error.message : "Unable to load lesson."
    return LessonReturnValue.parse({ data: null, error: message })
  }

  if (!lesson) {
    return LessonReturnValue.parse({ data: null, error: null })
  }

  const { lessons: enrichedLessons, error: scError } = await enrichLessonsWithSuccessCriteria([lesson])

  if (scError) {
    console.error("[v0] Failed to read success criteria for lesson:", scError)
    return LessonReturnValue.parse({ data: null, error: scError })
  }

  const enrichedLesson = enrichedLessons[0]

  const { lessons_learning_objective, lesson_links, ...rest } = enrichedLesson
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
