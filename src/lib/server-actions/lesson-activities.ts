"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  LessonActivitySchema,
  LessonActivitiesSchema,
  LessonJobResponseSchema,
  McqActivityBodySchema,
  ShortTextActivityBodySchema,
  FeedbackActivityBodySchema,
  type FeedbackActivityGroupSettings,
} from "@/types"
import { query, withDbClient } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"
import { isScorableActivityType } from "@/dino.config"
import { enqueueLessonMutationJob } from "@/lib/lesson-job-runner"

const LessonActivitiesReturnValue = z.object({
  data: LessonActivitiesSchema.nullable(),
  error: z.string().nullable(),
})

const CreateActivityInputSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  bodyData: z.unknown().nullable().optional(),
  isSummative: z.boolean().optional(),
  successCriteriaIds: z.array(z.string().min(1)).optional(),
})

const UpdateActivityInputSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  bodyData: z.unknown().nullable().optional(),
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
      let data: Array<Record<string, unknown>> = []
      try {
        const { rows } = await query(
          `
            select *
            from activities
            where lesson_id = $1
              and active = true
            order by order_by asc nulls first, title asc
          `,
          [lessonId],
        )
        data = rows ?? []
      } catch (error) {
        console.error("[v0] Failed to list lesson activities:", error)
        const message = error instanceof Error ? error.message : "Unable to list activities."
        return LessonActivitiesReturnValue.parse({ data: null, error: message })
      }

      const sorted = (data ?? []).sort((a, b) => {
        const aOrder = typeof a.order_by === "number" ? a.order_by : Number.MAX_SAFE_INTEGER
        const bOrder = typeof b.order_by === "number" ? b.order_by : Number.MAX_SAFE_INTEGER
        if (aOrder !== bOrder) {
          return aOrder - bOrder
        }
        const aTitle = typeof a.title === "string" ? a.title : ""
        const bTitle = typeof b.title === "string" ? b.title : ""
        return aTitle.localeCompare(bTitle)
      })

      const { data: enriched, error: scError } = await enrichActivitiesWithSuccessCriteria(sorted)

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
  const isSummativeAllowed = isScorableActivityType(payload.type)
  const isSummativeRequested = payload.isSummative ?? isSummativeAllowed

  if (isSummativeRequested && !isSummativeAllowed) {
    return {
      success: false,
      error: "Only scorable activity types can be marked as assessments.",
      data: null,
    }
  }

  let createdActivity: Record<string, unknown> | null = null

  try {
    await withDbClient(async (client) => {
      const { rows: maxOrderRows } = await client.query(
        `
          select order_by
          from activities
          where lesson_id = $1
          order by order_by desc nulls last
          limit 1
        `,
        [lessonId],
      )

      const maxOrder = maxOrderRows[0]?.order_by
      const nextOrder = typeof maxOrder === "number" ? maxOrder + 1 : 0

      const { rows } = await client.query(
        `
          insert into activities (
            lesson_id, title, type, body_data, is_summative, order_by, active
          )
          values ($1, $2, $3, $4, $5, $6, true)
          returning *
        `,
        [
          lessonId,
          payload.title,
          payload.type,
          normalizedBody.bodyData,
          isSummativeAllowed ? isSummativeRequested : false,
          nextOrder,
        ],
      )

      createdActivity = rows[0] ?? null

      if (!createdActivity) {
        throw new Error("Unable to create lesson activity.")
      }

      if (successCriteriaIds.length > 0) {
        await client.query(
          `
            insert into activity_success_criteria (activity_id, success_criteria_id)
            select $1, unnest($2::text[])
          `,
          [createdActivity.activity_id, successCriteriaIds],
        )
      }
    })
  } catch (error) {
    console.error("[v0] Failed to create lesson activity:", error)
    const message = error instanceof Error ? error.message : "Unable to create lesson activity."
    return { success: false, error: message, data: null }
  }

  const { data: hydratedRows, error: hydrationError } = await enrichActivitiesWithSuccessCriteria(
    createdActivity ? [createdActivity] : [],
  )

  if (hydrationError) {
    console.error("[v0] Failed to hydrate created activity success criteria:", hydrationError)
    return { success: false, error: hydrationError, data: null }
  }

  const hydratedActivity = (hydratedRows[0] ?? createdActivity) as Record<string, unknown> | null
  if (!hydratedActivity) {
    return { success: false, error: "Unable to load created activity.", data: null }
  }

  const normalizedActivity: Record<string, unknown> = {
    ...hydratedActivity,
    success_criteria_ids:
      Array.isArray((hydratedActivity as Record<string, unknown>)?.success_criteria_ids)
        ? (hydratedActivity as Record<string, unknown>).success_criteria_ids
        : successCriteriaIds,
    success_criteria: (hydratedActivity as Record<string, unknown>)?.success_criteria ?? [],
  }

  queueMicrotask(() => {
    revalidatePath(`/units/${unitId}`)
  })

  return {
    success: true,
    data: LessonActivitySchema.parse(normalizedActivity),
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

  const nextSuccessCriteriaIds =
    payload.successCriteriaIds !== undefined
      ? normalizeSuccessCriteriaIds(payload.successCriteriaIds)
      : null

  let existing: any = null
  try {
    const { rows } = await query(
      `
        select *
        from activities
        where activity_id = $1 and lesson_id = $2
        limit 1
      `,
      [activityId, lessonId],
    )
    existing = rows[0] ?? null
    if (!existing) {
      return { success: false, error: "Activity not found.", data: null }
    }
  } catch (error) {
    console.error("[v0] Failed to load activity for update:", error)
    const message = error instanceof Error ? error.message : "Unable to load activity."
    return { success: false, error: message, data: null }
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
    const setFragments: string[] = []
    const values: unknown[] = []
    let idx = 1
    for (const [key, value] of Object.entries(updates)) {
      setFragments.push(`${key} = $${idx++}`)
      values.push(value)
    }
    values.push(activityId)
    values.push(lessonId)

    try {
      const { rows } = await query(
        `
          update activities
          set ${setFragments.join(", ")}
          where activity_id = $${idx} and lesson_id = $${idx + 1}
          returning *
        `,
        values,
      )
      updatedActivityRow = rows[0] ?? updatedActivityRow
    } catch (error) {
      console.error("[v0] Failed to update lesson activity:", error)
      const message = error instanceof Error ? error.message : "Unable to update activity."
      return { success: false, error: message, data: null }
    }
  }

  if (nextSuccessCriteriaIds !== null) {
    try {
      const { rows: existingLinksRows } = await query<{ success_criteria_id: string }>(
        "select success_criteria_id from activity_success_criteria where activity_id = $1",
        [activityId],
      )

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
        await query(
          `
            delete from activity_success_criteria
            where activity_id = $1 and success_criteria_id = any($2::text[])
          `,
          [activityId, toDelete],
        )
      }

      if (toInsert.length > 0) {
        await query(
          `
            insert into activity_success_criteria (activity_id, success_criteria_id)
            select $1, unnest($2::text[])
          `,
          [activityId, toInsert],
        )
      }
    } catch (error) {
      console.error("[v0] Failed to update activity success criteria links:", error)
      const message = error instanceof Error ? error.message : "Unable to update activity links."
      return { success: false, error: message, data: null }
    }
  }

  const { data: hydratedRows, error: hydrationError } = await enrichActivitiesWithSuccessCriteria(
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

  queueMicrotask(() => {
    revalidatePath(`/units/${unitId}`)
    revalidatePath(`/lessons/${lessonId}`)
  })

  return { success: true, data: LessonActivitySchema.parse(hydratedActivity) }
}

export async function reorderLessonActivitiesAction(
  unitId: string,
  lessonId: string,
  input: z.infer<typeof ReorderActivityInputSchema>,
) {
  const payload = ReorderActivityInputSchema.parse(input)

  if (payload.length === 0) {
    return LessonJobResponseSchema.parse({
      status: "queued",
      jobId: null,
      message: "No activity changes detected.",
    })
  }

  const activityIds = payload.map((entry) => entry.activityId)
  try {
    const { rows: existing } = await query<{ activity_id: string }>(
      `
        select activity_id
        from activities
        where lesson_id = $1 and activity_id = any($2::text[])
      `,
      [lessonId, activityIds],
    )

    if ((existing ?? []).length !== activityIds.length) {
      return LessonJobResponseSchema.parse({
        status: "error",
        jobId: null,
        message: "Some activities were not found for this lesson.",
      })
    }
  } catch (error) {
    console.error("[v0] Failed to verify lesson activities for reorder:", error)
    return LessonJobResponseSchema.parse({
      status: "error",
      jobId: null,
      message: error instanceof Error ? error.message : "Unable to verify activities.",
    })
  }

  return enqueueLessonMutationJob({
    lessonId,
    unitId,
    type: "lesson.activities.reorder",
    message: "Activity reorder queued.",
    executor: async () => {
      await applyLessonActivitiesReorder(lessonId, payload)
      queueMicrotask(() => {
        revalidatePath(`/units/${unitId}`)
      })
    },
  })
}

async function applyLessonActivitiesReorder(
  lessonId: string,
  activities: Array<{ activityId: string; orderBy: number }>,
) {
  await withDbClient(async (client) => {
    for (const entry of activities) {
      await client.query(
        "update activities set order_by = $1 where activity_id = $2 and lesson_id = $3",
        [entry.orderBy, entry.activityId, lessonId],
      )
    }
  })
}

export async function deleteLessonActivityAction(unitId: string, lessonId: string, activityId: string) {
  try {
    await withDbClient(async (client) => {
      await client.query("delete from activity_success_criteria where activity_id = $1", [activityId])
      await client.query(
        "delete from activities where activity_id = $1 and lesson_id = $2",
        [activityId, lessonId],
      )
    })
  } catch (error) {
    console.error("[v0] Failed to delete lesson activity:", error)
    const message = error instanceof Error ? error.message : "Unable to delete lesson activity."
    return { success: false, error: message }
  }

  queueMicrotask(() => {
    revalidatePath(`/units/${unitId}`)
  })

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

  try {
    const { rows: links } = await query<{ activity_id: string; success_criteria_id: string }>(
      `
        select activity_id, success_criteria_id
        from activity_success_criteria
        where activity_id = any($1::text[])
      `,
      [activityIds],
    )

    const successCriteriaIds = Array.from(
      new Set(
        (links ?? [])
          .map((row) => row?.success_criteria_id)
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    )

    let successCriteriaDetails: Array<{
      success_criteria_id: string
      learning_objective_id: string | null
      description: string | null
      level: number | null
    }> = []

    if (successCriteriaIds.length > 0) {
      const { rows: criteriaRows } = await query<{
        success_criteria_id: string
        learning_objective_id: string | null
        description: string | null
        level: number | null
      }>(
        `
          select success_criteria_id, learning_objective_id, description, level
          from success_criteria
          where success_criteria_id = any($1::text[])
        `,
        [successCriteriaIds],
      )
      successCriteriaDetails = criteriaRows ?? []
    }

    const detailMap = new Map<
      string,
      { description: string | null; level: number | null; learning_objective_id: string | null }
    >()
    for (const row of successCriteriaDetails ?? []) {
      if (!row?.success_criteria_id) continue
      detailMap.set(row.success_criteria_id, {
        description: typeof row.description === "string" ? row.description : null,
        level: typeof row.level === "number" ? row.level : null,
        learning_objective_id: typeof row.learning_objective_id === "string" ? row.learning_objective_id : null,
      })
    }

    const payload = activities.map((activity) => {
      const linkedIds = (links ?? [])
        .filter((link) => link.activity_id === activity.activity_id)
        .map((link) => link.success_criteria_id)

      return {
        ...activity,
        success_criteria_ids: linkedIds,
        success_criteria: linkedIds.map((id) => {
          const details = detailMap.get(id) ?? {
            description: null,
            level: null,
            learning_objective_id: null,
          }

          const title =
            (details.description && details.description.trim().length > 0 ? details.description.trim() : null) ??
            "Success criterion"

          return {
            success_criteria_id: id,
            learning_objective_id: details.learning_objective_id,
            description: details.description,
            level: details.level,
            title,
          }
        }),
      }
    })

    return { data: payload, error: null }
  } catch (error) {
    console.error("[v0] Failed to load activity success criteria links/details:", error)
    const message = error instanceof Error ? error.message : "Unable to load activity success criteria."
    return { data: [], error: message }
  }
}

function normalizeActivityBody(
  type: string,
  bodyData: unknown,
  options?: { allowFallback?: boolean },
): { success: true; bodyData: unknown } | { success: false; error: string } {
  if (!type) {
    return { success: false, error: "Activity type is required." }
  }

  const trimmed = typeof type === "string" ? type.trim() : ""
  if (!trimmed) {
    return { success: false, error: "Activity type is required." }
  }

  switch (trimmed) {
    case "mcq": {
      const parsed = McqActivityBodySchema.safeParse(bodyData)
      if (!parsed.success) {
        return { success: false, error: "Invalid multiple-choice activity body." }
      }
      return { success: true, bodyData: parsed.data }
    }
    case "short-text-question": {
      const parsed = ShortTextActivityBodySchema.safeParse(bodyData)
      if (!parsed.success) {
        return { success: false, error: "Invalid short text activity body." }
      }
      return { success: true, bodyData: parsed.data }
    }
    case "feedback": {
      const parsed = FeedbackActivityBodySchema.safeParse(bodyData)
      if (!parsed.success) {
        return { success: false, error: "Invalid feedback activity body." }
      }
      const data = parsed.data ?? null
      return { success: true, bodyData: data }
    }
    default: {
      if (options?.allowFallback && typeof bodyData !== "undefined") {
        return { success: true, bodyData }
      }
      if (bodyData === null) {
        return { success: true, bodyData: null }
      }
      if (typeof bodyData === "object" || typeof bodyData === "string") {
        return { success: true, bodyData }
      }
      return { success: false, error: "Unsupported activity body format." }
    }
  }
}

function normalizeSuccessCriteria(successCriteriaIds: string[], details: Map<string, unknown>) {
  const entries = successCriteriaIds.map((id) => {
    const detail = details.get(id) as any
    const title =
      detail?.description && typeof detail.description === "string" && detail.description.trim().length > 0
        ? detail.description.trim()
        : "Success criterion"

    return {
      success_criteria_id: id,
      learning_objective_id: detail?.learning_objective_id ?? null,
      description: detail?.description ?? null,
      level: detail?.level ?? null,
      title,
    }
  })

  return entries
}
const deferRevalidate = (path: string) => {
  if (path.includes("/lessons/")) {
    return
  }
  queueMicrotask(() => revalidatePath(path))
}
