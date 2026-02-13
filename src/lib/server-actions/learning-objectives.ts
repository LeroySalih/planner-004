"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { LearningObjectiveSchema, SuccessCriteriaSchema } from "@/types"
import { query, withDbClient } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"
import { Client } from "pg"

const LearningObjectiveWithCriteriaSchema = LearningObjectiveSchema.extend({
  success_criteria: SuccessCriteriaSchema.default([]),
})

const LearningObjectivesWithCriteriaSchema = z.array(LearningObjectiveWithCriteriaSchema)

const LearningObjectivesReturnValue = z.object({
  data: LearningObjectivesWithCriteriaSchema.nullable(),
  error: z.string().nullable(),
})

const LearningObjectiveReturnValue = z.object({
  data: LearningObjectiveWithCriteriaSchema.nullable(),
  error: z.string().nullable(),
})

const SuccessCriterionInputSchema = z.object({
  success_criteria_id: z.string().optional(),
  description: z.string().trim().optional(),
  title: z.string().trim().optional(),
  level: z.number().min(1).max(9).optional(),
  order_index: z.number().optional(),
  active: z.boolean().optional(),
  unit_ids: z.array(z.string()).optional(),
})

const SuccessCriteriaInputSchema = z.array(SuccessCriterionInputSchema)

export type LearningObjectiveWithCriteria = z.infer<typeof LearningObjectiveWithCriteriaSchema>
export type SuccessCriteriaInput = z.infer<typeof SuccessCriteriaInputSchema>

function resolvePgConnectionString() {
  return process.env.DATABASE_URL ?? null
}

function createPgClient() {
  const connectionString = resolvePgConnectionString()
  if (!connectionString) {
    throw new Error("Database connection is not configured (DATABASE_URL missing).")
  }

  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

async function readLearningObjectivesWithCriteria(options: {
  learningObjectiveIds?: string[]
  filterUnitId?: string
  curriculumIds?: string[]
}): Promise<z.infer<typeof LearningObjectivesReturnValue>> {
  const { learningObjectiveIds = [], filterUnitId, curriculumIds = [] } = options
  const debugContext = {
    filterUnitId: filterUnitId ?? null,
    requestedIds: learningObjectiveIds.length,
    curriculumIds: curriculumIds.length,
    routeTag: "/learning-objectives",
  }

  console.log("[learning-objectives] Start readLearningObjectivesWithCriteria", debugContext)

  let client: Client | null = null
  try {
    client = createPgClient()
    await client.connect()

    let initialMeta: Array<{
      learning_objective_id: string
      assessment_objective_id: string | null
      title: string | null
      order_index: number | null
      active: boolean | null
      spec_ref: string | null
      assessment_objective?: {
        assessment_objective_id?: string | null
        curriculum_id?: string | null
        unit_id?: string | null
        code?: string | null
        title?: string | null
        order_index?: number | null
      } | null
    }> = []

    let curriculumObjectiveIds: string[] = []

    if (curriculumIds.length > 0 && learningObjectiveIds.length === 0) {
      const { rows } = await client.query(
        `
          select lo.learning_objective_id,
                 lo.assessment_objective_id,
                 lo.title,
                 lo.order_index,
                 lo.active,
                 lo.spec_ref,
                 ao.assessment_objective_id as ao_id,
                 ao.curriculum_id as ao_curriculum_id,
                 ao.unit_id as ao_unit_id,
                 ao.code as ao_code,
                 ao.title as ao_title,
                 ao.order_index as ao_order_index
          from learning_objectives lo
          join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
          where ao.curriculum_id = any($1::text[])
        `,
        [curriculumIds],
      )

      initialMeta = (rows ?? []).map((row) => ({
        learning_objective_id: row.learning_objective_id,
        assessment_objective_id: row.assessment_objective_id,
        title: row.title,
        order_index: row.order_index,
        active: row.active,
        spec_ref: row.spec_ref,
        assessment_objective: {
          assessment_objective_id: row.ao_id,
          curriculum_id: row.ao_curriculum_id,
          unit_id: row.ao_unit_id,
          code: row.ao_code,
          title: row.ao_title,
          order_index: row.ao_order_index,
        },
      }))

      curriculumObjectiveIds = initialMeta
        .map((item) => item.learning_objective_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)

      console.log("[learning-objectives] Loaded objectives by curriculum", {
        curriculumIds,
        count: curriculumObjectiveIds.length,
        filterUnitId,
        routeTag: debugContext.routeTag,
      })
    }

    const targetLearningObjectiveIds =
      learningObjectiveIds.length > 0 ? learningObjectiveIds : curriculumObjectiveIds

    if (targetLearningObjectiveIds.length === 0) {
      console.log("[learning-objectives] No objective IDs to load", debugContext)
      return LearningObjectivesReturnValue.parse({ data: [], error: null })
    }

    const { rows: criteriaRows } = await client.query(
      `
        select sc.success_criteria_id,
               sc.learning_objective_id,
               sc.level,
               sc.description,
               sc.order_index,
               sc.active
        from success_criteria sc
        where sc.learning_objective_id = any($1::text[])
      `,
      [targetLearningObjectiveIds],
    )

    const successCriteriaMap = new Map<string, NormalizedSuccessCriterion[]>()
    for (const row of criteriaRows ?? []) {
      const entry: NormalizedSuccessCriterion = {
        success_criteria_id: row.success_criteria_id,
        learning_objective_id: row.learning_objective_id,
        level: row.level,
        description: row.description,
        order_index: row.order_index,
        active: row.active ?? true,
        units: [],
      }
      const bucket = successCriteriaMap.get(row.learning_objective_id) ?? []
      bucket.push(entry)
      successCriteriaMap.set(row.learning_objective_id, bucket)
    }

    console.log("[learning-objectives] Loading objectives", {
      ...debugContext,
      objectiveIdsToLoad: targetLearningObjectiveIds.length,
      criteriaCount: criteriaRows?.length ?? 0,
    })

    let learningObjectives = initialMeta

    if (learningObjectives.length === 0) {
      const { rows } = await client.query(
        `
          select lo.learning_objective_id,
                 lo.assessment_objective_id,
                 lo.title,
                 lo.order_index,
                 lo.active,
                 lo.spec_ref,
                 ao.assessment_objective_id as ao_id,
                 ao.curriculum_id as ao_curriculum_id,
                 ao.unit_id as ao_unit_id,
                 ao.code as ao_code,
                 ao.title as ao_title,
                 ao.order_index as ao_order_index
          from learning_objectives lo
          left join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
          where lo.learning_objective_id = any($1::text[])
          order by lo.order_index asc
        `,
        [targetLearningObjectiveIds],
      )

      learningObjectives = rows ?? []
    }

    const metaMap = new Map(
      (learningObjectives ?? []).map((lo) => [lo.learning_objective_id ?? "", lo]),
    )

    const normalized = Array.from(successCriteriaMap.entries())
      .map(([learningObjectiveId, criteria], index) => {
        const meta = metaMap.get(learningObjectiveId)
        const assessmentObjective = meta
          ? {
              assessment_objective_id: meta.assessment_objective_id ?? null,
              curriculum_id:
                typeof meta.assessment_objective === "object" && meta.assessment_objective
                  ? (meta.assessment_objective as { curriculum_id?: string | null }).curriculum_id ?? null
                  : null,
              unit_id:
                typeof meta.assessment_objective === "object" && meta.assessment_objective
                  ? (meta.assessment_objective as { unit_id?: string | null }).unit_id ?? null
                  : null,
              code:
                typeof meta.assessment_objective === "object" && meta.assessment_objective
                  ? (meta.assessment_objective as { code?: string | null }).code ?? null
                  : null,
              title:
                typeof meta.assessment_objective === "object" && meta.assessment_objective
                  ? (meta.assessment_objective as { title?: string | null }).title ?? null
                  : null,
              order_index:
                typeof meta.assessment_objective === "object" && meta.assessment_objective
                  ? (meta.assessment_objective as { order_index?: number | null }).order_index ?? null
                  : null,
            }
          : null
        return {
          learning_objective_id: learningObjectiveId,
          assessment_objective_id: meta?.assessment_objective_id ?? null,
          spec_ref: meta?.spec_ref ?? null,
          assessment_objective_code: assessmentObjective?.code ?? null,
          assessment_objective_title: assessmentObjective?.title ?? null,
          assessment_objective_order_index:
            typeof assessmentObjective?.order_index === "number" ? assessmentObjective.order_index : null,
          assessment_objective_curriculum_id: assessmentObjective?.curriculum_id ?? null,
          assessment_objective_unit_id: assessmentObjective?.unit_id ?? null,
          title: meta?.title ?? "",
          order_index: meta?.order_index ?? index,
          active: meta?.active ?? true,
          success_criteria: criteria,
        }
      })
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

    console.log("[learning-objectives] Completed readLearningObjectivesWithCriteria", {
      ...debugContext,
      objectiveCount: normalized.length,
      successCriteriaCount: successCriteriaMap.size,
    })

    return LearningObjectivesReturnValue.parse({ data: normalized, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const stack = error instanceof Error ? error.stack : null
    console.error("[learning-objectives] Failed to read objectives via PG", {
      ...debugContext,
      errorMessage: message,
      stack,
      connectionInfo: {
        hasEnv: Boolean(resolvePgConnectionString()),
      },
    })
    return LearningObjectivesReturnValue.parse({ data: null, error: message })
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

export async function readLearningObjectivesByUnitAction(
  unitId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/learning-objectives:byUnit"

  return withTelemetry(
    {
      routeTag,
      functionName: "readLearningObjectivesByUnitAction",
      params: { unitId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for learning objectives:", { unitId })
      return readLearningObjectivesWithCriteria({ filterUnitId: unitId })
    },
  )
}

export async function readAllLearningObjectivesAction(
  options?: { authEndTime?: number | null; routeTag?: string; curriculumIds?: string[]; unitId?: string | null },
): Promise<z.infer<typeof LearningObjectivesReturnValue>> {
  const routeTag = options?.routeTag ?? "/learning-objectives:all"
  const curriculumIds = (options?.curriculumIds ?? []).filter((id) => typeof id === "string" && id.trim().length > 0)
  const filterUnitId = options?.unitId ?? undefined

  return withTelemetry(
    {
      routeTag,
      functionName: "readAllLearningObjectivesAction",
      params: { curriculumIds: curriculumIds.length, unitId: filterUnitId ?? null },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for curriculum learning objectives", {
        curriculumIdsCount: curriculumIds.length,
        unitId: filterUnitId ?? null,
      })

      return readLearningObjectivesWithCriteria({
        curriculumIds,
        filterUnitId,
      })
    },
  )
}

export type NormalizedSuccessCriterion = {
  success_criteria_id: string
  learning_objective_id: string
  level: number
  description: string
  order_index: number | null
  active: boolean
  units: string[]
}


export async function fetchSuccessCriteriaForLearningObjectives(
  learningObjectiveIds: string[],
  filterUnitId?: string,
): Promise<{
  map: Map<string, NormalizedSuccessCriterion[]>
  learningObjectiveIds: string[]
  error: string | null
}> {
  console.log("[learning-objectives] Fetching success criteria", {
    filterUnitId,
    hasSuppliedIds: learningObjectiveIds.length > 0,
  })

  const client = createPgClient()
  await client.connect()

  try {
    let criteriaRows: Array<{
      success_criteria_id: string
      learning_objective_id: string
      level: number | null
      description: string | null
      order_index: number | null
      active: boolean | null
    }> = []

    if (filterUnitId) {
      const { rows } = await client.query(
        `
          select sc.success_criteria_id,
                 sc.learning_objective_id,
                 sc.level,
                 sc.description,
                 sc.order_index,
                 sc.active
          from success_criteria sc
          join success_criteria_units scu on scu.success_criteria_id = sc.success_criteria_id
          where scu.unit_id = $1
        `,
        [filterUnitId],
      )
      criteriaRows = rows ?? []
    } else if (learningObjectiveIds.length > 0) {
      const { rows } = await client.query(
        `
          select success_criteria_id,
                 learning_objective_id,
                 level,
                 description,
                 order_index,
                 active
          from success_criteria
          where learning_objective_id = any($1::text[])
        `,
        [learningObjectiveIds],
      )
      criteriaRows = rows ?? []
    }

    const successCriteriaIds = criteriaRows.map((row) => row.success_criteria_id)
    const unitsByCriterion = new Map<string, string[]>()

    if (successCriteriaIds.length > 0) {
      const { rows: unitRows } = await client.query(
        `
          select success_criteria_id, unit_id
          from success_criteria_units
          where success_criteria_id = any($1::text[])
        `,
        [successCriteriaIds],
      )

      for (const unitRow of unitRows ?? []) {
        const units = unitsByCriterion.get(unitRow.success_criteria_id) ?? []
        units.push(unitRow.unit_id)
        unitsByCriterion.set(unitRow.success_criteria_id, units)
      }
    }

    const successCriteriaMap = new Map<string, NormalizedSuccessCriterion[]>()
    const loadedLearningObjectiveIds = new Set<string>()

    for (const criterion of criteriaRows ?? []) {
      const bucket = successCriteriaMap.get(criterion.learning_objective_id) ?? []
      bucket.push({
        success_criteria_id: criterion.success_criteria_id,
        learning_objective_id: criterion.learning_objective_id,
        level: criterion.level ?? 0,
        description: criterion.description ?? "",
        order_index: criterion.order_index ?? 0,
        active: criterion.active ?? true,
        units: unitsByCriterion.get(criterion.success_criteria_id) ?? [],
      })
      successCriteriaMap.set(criterion.learning_objective_id, bucket)
      loadedLearningObjectiveIds.add(criterion.learning_objective_id)
    }

    successCriteriaMap.forEach((bucket) =>
      bucket.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    )

    return {
      map: successCriteriaMap,
      learningObjectiveIds: Array.from(loadedLearningObjectiveIds),
      error: null,
    }
  } catch (error) {
    console.error("[learning-objectives] Failed to load success_criteria", error, {
      filterUnitId,
      requestedIds: learningObjectiveIds.length,
    })
    return {
      map: new Map(),
      learningObjectiveIds: [],
      error: error instanceof Error ? error.message : "Unable to load success criteria.",
    }
  } finally {
    try {
      await client.end()
    } catch {
      // ignore
    }
  }
}

export async function createLearningObjectiveAction(
  unitId: string,
  title: string,
  successCriteria: SuccessCriteriaInput,
  specRef?: string | null,
) {
  console.log("[v0] Server action started for learning objective creation:", {
    unitId,
    title,
    hasSpecRef: Boolean(specRef?.trim()),
  })

  const sanitizedSuccessCriteria = SuccessCriteriaInputSchema.parse(successCriteria).map((criterion, index) => {
    const description = (criterion.description ?? criterion.title ?? "").trim()
    return {
      success_criteria_id: criterion.success_criteria_id,
      description,
      level: criterion.level ?? 1,
      active: criterion.active ?? true,
      order_index: criterion.order_index ?? index,
      unit_ids: criterion.unit_ids ?? [],
    }
  })
  const filteredCriteria = sanitizedSuccessCriteria.filter((criterion) => criterion.description.length > 0)

  const normalizedSpecRef = specRef?.trim() ? specRef.trim() : null

  let createdLearningObjectiveId: string | null = null

  try {
    await withDbClient(async (client) => {
      const { rows: aoRows } = await client.query(
        "select assessment_objective_id from assessment_objectives where unit_id = $1 limit 1",
        [unitId],
      )
      const assessmentObjectiveId = aoRows?.[0]?.assessment_objective_id ?? null

      if (!assessmentObjectiveId) {
        throw new Error("No assessment objective found for unit")
      }

      const { rows: loRows } = await client.query(
        `
          insert into learning_objectives (assessment_objective_id, title, spec_ref, active)
          values ($1, $2, $3, true)
          returning learning_objective_id
        `,
        [assessmentObjectiveId, title, normalizedSpecRef],
      )

      createdLearningObjectiveId = loRows?.[0]?.learning_objective_id ?? null

      if (!createdLearningObjectiveId) {
        throw new Error("Unable to create learning objective.")
      }

      // Batch insert all success criteria (N+1 fix)
      if (filteredCriteria.length > 0) {
        const scValues: unknown[] = []
        const scPlaceholders: string[] = []

        filteredCriteria.forEach((criterion, idx) => {
          const base = idx * 5
          scValues.push(
            createdLearningObjectiveId,
            criterion.description,
            criterion.level,
            criterion.order_index,
            criterion.active
          )
          scPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`)
        })

        const { rows: insertedCriteria } = await client.query(
          `
            insert into success_criteria (learning_objective_id, description, level, order_index, active)
            values ${scPlaceholders.join(", ")}
            returning success_criteria_id
          `,
          scValues
        )

        if (insertedCriteria.length !== filteredCriteria.length) {
          throw new Error("Unable to create all success criteria.")
        }

        // Batch insert all unit associations
        const unitValues: unknown[] = []
        const unitPlaceholders: string[] = []

        insertedCriteria.forEach((row, idx) => {
          const unitIds = filteredCriteria[idx].unit_ids ?? []
          unitIds.forEach((unitId) => {
            unitValues.push(row.success_criteria_id, unitId)
            unitPlaceholders.push(`($${unitValues.length - 1}, $${unitValues.length})`)
          })
        })

        if (unitPlaceholders.length > 0) {
          await client.query(
            `
              insert into success_criteria_units (success_criteria_id, unit_id)
              values ${unitPlaceholders.join(", ")}
            `,
            unitValues
          )
        }
      }
    })
  } catch (creationError) {
    console.error("[v0] Failed to create learning objective:", creationError)
    const message = creationError instanceof Error ? creationError.message : "Unable to create learning objective."
    return LearningObjectiveReturnValue.parse({ data: null, error: message })
  }

  if (!createdLearningObjectiveId) {
    return LearningObjectiveReturnValue.parse({ data: null, error: "Unable to create learning objective." })
  }

  const finalObjective = await readSingleLearningObjective(createdLearningObjectiveId)

  revalidatePath(`/units/${unitId}`)
  return finalObjective
}

export async function updateLearningObjectiveAction(
  learningObjectiveId: string,
  unitId: string,
  title: string,
  successCriteria: SuccessCriteriaInput,
  specRef?: string | null,
) {
  console.log("[v0] Server action started for learning objective update:", {
    learningObjectiveId,
    unitId,
    title,
    hasSpecRef: Boolean(specRef?.trim()),
  })

  const sanitizedSuccessCriteria = SuccessCriteriaInputSchema.parse(successCriteria).map((criterion, index) => {
    const description = (criterion.description ?? criterion.title ?? "").trim()
    return {
      success_criteria_id: criterion.success_criteria_id,
      description,
      level: criterion.level ?? 1,
      active: criterion.active ?? true,
      order_index: criterion.order_index ?? index,
      unit_ids: criterion.unit_ids ?? [],
    }
  })
  const filteredCriteria = sanitizedSuccessCriteria.filter((criterion) => criterion.description.length > 0)

  const normalizedSpecRef = specRef?.trim() ? specRef.trim() : null

  try {
    await withDbClient(async (client) => {
      await client.query("update learning_objectives set title = $1, spec_ref = $2 where learning_objective_id = $3", [
        title,
        normalizedSpecRef,
        learningObjectiveId,
      ])

      const { rows: existingCriteria } = await client.query<{
        success_criteria_id: string
        level: number | null
        description: string | null
        order_index: number | null
        active: boolean | null
        unit_ids: string[] | null
      }>(
        `
          select sc.success_criteria_id,
                 sc.level,
                 sc.description,
                 sc.order_index,
                 sc.active,
                 coalesce(array_agg(scu.unit_id) filter (where scu.unit_id is not null), '{}') as unit_ids
          from success_criteria sc
          left join success_criteria_units scu on scu.success_criteria_id = sc.success_criteria_id
          where sc.learning_objective_id = $1
          group by sc.success_criteria_id
        `,
        [learningObjectiveId],
      )

      const existingIds = new Set((existingCriteria ?? []).map((criterion) => criterion.success_criteria_id))
      const incomingIds = new Set(
        filteredCriteria
          .map((criterion) => criterion.success_criteria_id)
          .filter((id): id is string => Boolean(id)),
      )

      const idsToDelete = Array.from(existingIds).filter((id) => !incomingIds.has(id))

      if (idsToDelete.length > 0) {
        await client.query("delete from success_criteria where success_criteria_id = any($1::text[])", [idsToDelete])
      }

      const updates = filteredCriteria.filter((criterion) => criterion.success_criteria_id)
      for (const criterion of updates) {
        await client.query(
          `
            update success_criteria
            set description = $1, level = $2, order_index = $3, active = $4
            where success_criteria_id = $5
          `,
          [criterion.description, criterion.level, criterion.order_index, criterion.active, criterion.success_criteria_id],
        )

        const existingUnits = new Set(
          (existingCriteria ?? []).find((row) => row.success_criteria_id === criterion.success_criteria_id)?.unit_ids ??
            [],
        )
        const incomingUnits = new Set(criterion.unit_ids ?? [])

        const unitsToRemove = Array.from(existingUnits).filter((unitId) => !incomingUnits.has(unitId))
        const unitsToAdd = Array.from(incomingUnits).filter((unitId) => !existingUnits.has(unitId))

        if (unitsToRemove.length > 0) {
          await client.query(
            `
              delete from success_criteria_units
              where success_criteria_id = $1
                and unit_id = any($2::text[])
            `,
            [criterion.success_criteria_id, unitsToRemove],
          )
        }

        if (unitsToAdd.length > 0) {
          const values: Array<unknown> = []
          const placeholders: string[] = []
          unitsToAdd.forEach((unitId, index) => {
            values.push(criterion.success_criteria_id, unitId)
            placeholders.push(`($${values.length - 1}, $${values.length})`)
          })

          await client.query(
            `
              insert into success_criteria_units (success_criteria_id, unit_id)
              values ${placeholders.join(", ")}
            `,
            values,
          )
        }
      }

      // Batch insert new success criteria (N+1 fix)
      const inserts = filteredCriteria.filter((criterion) => !criterion.success_criteria_id)
      if (inserts.length > 0) {
        const scValues: unknown[] = []
        const scPlaceholders: string[] = []

        inserts.forEach((criterion, idx) => {
          const base = idx * 5
          scValues.push(
            learningObjectiveId,
            criterion.description,
            criterion.level,
            criterion.order_index,
            criterion.active
          )
          scPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`)
        })

        const { rows: insertedRows } = await client.query(
          `
            insert into success_criteria (learning_objective_id, description, level, order_index, active)
            values ${scPlaceholders.join(", ")}
            returning success_criteria_id
          `,
          scValues
        )

        if (insertedRows.length !== inserts.length) {
          throw new Error("Unable to create all success criteria.")
        }

        // Batch insert unit associations for new criteria
        const unitValues: unknown[] = []
        const unitPlaceholders: string[] = []

        insertedRows.forEach((row, idx) => {
          const units = inserts[idx].unit_ids ?? []
          units.forEach((unitId) => {
            unitValues.push(row.success_criteria_id, unitId)
            unitPlaceholders.push(`($${unitValues.length - 1}, $${unitValues.length})`)
          })
        })

        if (unitPlaceholders.length > 0) {
          await client.query(
            `
              insert into success_criteria_units (success_criteria_id, unit_id)
              values ${unitPlaceholders.join(", ")}
            `,
            unitValues
          )
        }
      }
    })
  } catch (updateError) {
    console.error("[v0] Failed to update learning objective:", updateError)
    const message = updateError instanceof Error ? updateError.message : "Unable to update learning objective."
    return LearningObjectiveReturnValue.parse({ data: null, error: message })
  }

  const finalObjective = await readSingleLearningObjective(learningObjectiveId)

  revalidatePath(`/units/${unitId}`)
  return finalObjective
}

export async function deleteLearningObjectiveAction(learningObjectiveId: string, unitId: string) {
  console.log("[v0] Server action started for learning objective deletion:", { learningObjectiveId })

  try {
    await query("delete from learning_objectives where learning_objective_id = $1", [learningObjectiveId])
  } catch (error) {
    console.error("[v0] Failed to delete learning objective:", error)
    const message = error instanceof Error ? error.message : "Unable to delete learning objective."
    return { success: false, error: message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

export async function reorderLearningObjectivesAction(
  unitId: string,
  ordering: { learningObjectiveId: string; orderBy: number }[],
) {
  console.log("[v0] Server action started for learning objective reordering:", {
    unitId,
    count: ordering.length,
  })

  const updates = [...ordering].sort((a, b) => a.orderBy - b.orderBy)

  try {
    await withDbClient(async (client) => {
      // Batch update all order_index values (N+1 fix)
      if (updates.length > 0) {
        const ids = updates.map(u => u.learningObjectiveId)
        const orderIndexes = updates.map(u => u.orderBy)

        await client.query(
          `UPDATE learning_objectives lo
           SET order_index = data.order_index
           FROM (
             SELECT unnest($1::text[]) as learning_objective_id,
                    unnest($2::integer[]) as order_index
           ) AS data
           WHERE lo.learning_objective_id = data.learning_objective_id`,
          [ids, orderIndexes]
        )
      }
    })
  } catch (error) {
    console.error("[v0] Failed to reorder learning objective:", error)
    const message = error instanceof Error ? error.message : "Unable to reorder learning objectives."
    return { success: false, error: message }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

async function readSingleLearningObjective(learningObjectiveId: string) {
  const { data, error } = await readLearningObjectivesWithCriteria({ learningObjectiveIds: [learningObjectiveId] })

  if (error) {
    return LearningObjectiveReturnValue.parse({ data: null, error })
  }

  const first = data?.[0] ?? null
  return LearningObjectiveReturnValue.parse({ data: first, error: null })
}
