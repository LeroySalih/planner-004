"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { LearningObjectiveSchema, SuccessCriteriaSchema } from "@/types"
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server"
import { withTelemetry } from "@/lib/telemetry"
import type { SupabaseClient } from "@supabase/supabase-js"
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

async function readLearningObjectivesWithCriteria(options: {
  learningObjectiveIds?: string[]
  filterUnitId?: string
  curriculumIds?: string[]
}) {
  const { learningObjectiveIds = [], filterUnitId, curriculumIds = [] } = options
  const debugContext = {
    filterUnitId: filterUnitId ?? null,
    requestedIds: learningObjectiveIds.length,
    curriculumIds: curriculumIds.length,
  }

  return [];

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
    console.error("[learning-objectives] Failed to read objectives via PG:", error)
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
) {
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
  supabaseClient?: SupabaseClient,
): Promise<{
  map: Map<string, NormalizedSuccessCriterion[]>
  learningObjectiveIds: string[]
  error: string | null
}> {
  const supabase = supabaseClient ?? (await createSupabaseServerClient())
  console.log("[learning-objectives] Fetching success criteria", {
    filterUnitId,
    hasSuppliedIds: learningObjectiveIds.length > 0,
  })

  let criteriaQuery = supabase
    .from("success_criteria")
    .select("success_criteria_id, learning_objective_id, level, description, order_index, active")

  let criterionIdsToFetch: string[] | null = null

  if (learningObjectiveIds.length > 0) {
    criteriaQuery = criteriaQuery.in("learning_objective_id", learningObjectiveIds)
  } else if (filterUnitId) {
    const { data: linkRows, error: linkError } = await supabase
      .from("success_criteria_units")
      .select("success_criteria_id")
      .eq("unit_id", filterUnitId)

    if (linkError) {
      console.error("[learning-objectives] Failed to load success_criteria_units", linkError, {
        filterUnitId,
      })
      return { map: new Map(), learningObjectiveIds: [], error: linkError.message }
    }

    const criterionIds = (linkRows ?? [])
      .map((row) => row.success_criteria_id)
      .filter((id): id is string => Boolean(id))

    if (criterionIds.length === 0) {
      console.log("[learning-objectives] No linked success criteria for unit", { filterUnitId })
      return { map: new Map(), learningObjectiveIds: [], error: null }
    }

    console.log("[learning-objectives] Loaded success_criteria_units links", {
      filterUnitId,
      linkCount: criterionIds.length,
    })

    criterionIdsToFetch = criterionIds
    criteriaQuery = criteriaQuery.in("success_criteria_id", criterionIds)
  }

  const { data: criteriaRows, error: criteriaError } = await criteriaQuery

  if (criteriaError) {
    console.error("[learning-objectives] Failed to load success_criteria", criteriaError, {
      filterUnitId,
      requestedIds: learningObjectiveIds.length,
      criteriaIdsToFetch: criterionIdsToFetch?.length ?? null,
    })
    return { map: new Map(), learningObjectiveIds: [], error: criteriaError.message }
  }

  const criteria = criteriaRows ?? []
  if (criteria.length === 0) {
    return { map: new Map(), learningObjectiveIds: [], error: null }
  }

  const criterionIds = criterionIdsToFetch ?? criteria.map((row) => row.success_criteria_id).filter(Boolean)

  if (criterionIds.length === 0) {
    return { map: new Map(), learningObjectiveIds: [], error: null }
  }

  const { data: linkRows, error: linkError } = await supabase
    .from("success_criteria_units")
    .select("success_criteria_id, unit_id")
    .in("success_criteria_id", criterionIds)

  if (linkError) {
    return { map: new Map(), learningObjectiveIds: [], error: linkError.message }
  }

  const unitsByCriterion = new Map<string, string[]>()
  for (const link of linkRows ?? []) {
    if (!link.success_criteria_id) continue
    const units = unitsByCriterion.get(link.success_criteria_id) ?? []
    units.push(link.unit_id)
    unitsByCriterion.set(link.success_criteria_id, units)
  }

  let allowedCriterionIds: Set<string> | null = null

  if (filterUnitId) {
    allowedCriterionIds = new Set(
      (linkRows ?? [])
        .filter((link) => link.unit_id === filterUnitId)
        .map((link) => link.success_criteria_id)
        .filter((id): id is string => Boolean(id)),
    )
  }

  const map = new Map<string, NormalizedSuccessCriterion[]>()
  const learningObjectiveIdSet = new Set<string>()

  for (const criterion of criteria) {
    const criterionId = criterion.success_criteria_id
    const learningObjectiveId = criterion.learning_objective_id

    if (!criterionId || !learningObjectiveId) continue

    if (filterUnitId) {
      const units = unitsByCriterion.get(criterionId) ?? []
      if (units.length > 0 && allowedCriterionIds && !allowedCriterionIds.has(criterionId)) {
        continue
      }
    }

    const entry: NormalizedSuccessCriterion = {
      success_criteria_id: criterionId,
      learning_objective_id: learningObjectiveId,
      level: criterion.level ?? 1,
      description: criterion.description ?? "",
      order_index: criterion.order_index ?? null,
      active: criterion.active ?? true,
      units: unitsByCriterion.get(criterionId) ?? [],
    }

    const collection = map.get(learningObjectiveId) ?? []
    collection.push(entry)
    map.set(learningObjectiveId, collection)
    learningObjectiveIdSet.add(learningObjectiveId)
  }

  for (const [key, list] of map.entries()) {
    list.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level
      }
      return (a.order_index ?? 0) - (b.order_index ?? 0)
    })
    map.set(key, list)
  }

  return { map, learningObjectiveIds: Array.from(learningObjectiveIdSet), error: null }
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

  let supabase
  try {
    supabase = await createSupabaseServiceClient()
  } catch {
    supabase = await createSupabaseServerClient()
  }

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

  const { data: assessmentObjective, error: readAoError } = await supabase
    .from("assessment_objectives")
    .select("assessment_objective_id")
    .eq("unit_id", unitId)
    .maybeSingle()

  if (readAoError) {
    console.error("[v0] Failed to read assessment objective for unit:", readAoError)
    return LearningObjectiveReturnValue.parse({ data: null, error: readAoError.message })
  }

  if (!assessmentObjective) {
    return LearningObjectiveReturnValue.parse({ data: null, error: "No assessment objective found for unit" })
  }

  const normalizedSpecRef = specRef?.trim() ? specRef.trim() : null

  const { data: learningObjective, error } = await supabase
    .from("learning_objectives")
    .insert({
      assessment_objective_id: assessmentObjective.assessment_objective_id,
      title,
      spec_ref: normalizedSpecRef,
    })
    .select("*")
    .single()

  if (error) {
    console.error("[v0] Failed to create learning objective:", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  if (filteredCriteria.length > 0) {
    const { data: insertedCriteria, error: insertError } = await supabase
      .from("success_criteria")
      .insert(
        filteredCriteria.map((criterion) => ({
          learning_objective_id: learningObjective.learning_objective_id,
          description: criterion.description,
          level: criterion.level,
          order_index: criterion.order_index,
          active: criterion.active,
        })),
      )
      .select("success_criteria_id, order_index")

    if (insertError) {
      console.error("[v0] Failed to insert success criteria:", insertError)
      return LearningObjectiveReturnValue.parse({ data: null, error: insertError.message })
    }

    const successCriteriaRows = insertedCriteria ?? []

    for (let index = 0; index < successCriteriaRows.length; index++) {
      const row = successCriteriaRows[index]
      const payload = filteredCriteria[index]
      if (!payload) continue

      const unitIds = payload.unit_ids ?? []
      if (unitIds.length > 0) {
        const { error: unitInsertError } = await supabase
          .from("success_criteria_units")
          .insert(
            unitIds.map((unitId) => ({
              success_criteria_id: row.success_criteria_id,
              unit_id: unitId,
            })),
          )

        if (unitInsertError) {
          console.error("[v0] Failed to link success criteria units:", unitInsertError)
          return LearningObjectiveReturnValue.parse({ data: null, error: unitInsertError.message })
        }
      }
    }
  }

  const finalObjective = await readSingleLearningObjective(learningObjective.learning_objective_id)

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

  const supabase = await createSupabaseServerClient()

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

  const { error } = await supabase
    .from("learning_objectives")
    .update({ title, spec_ref: normalizedSpecRef })
    .eq("learning_objective_id", learningObjectiveId)

  if (error) {
    console.error("[v0] Failed to update learning objective:", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  const { data: existingCriteria, error: readCriteriaError } = await supabase
    .from("success_criteria")
    .select("success_criteria_id, level, description, order_index, active, success_criteria_units(unit_id)")
    .eq("learning_objective_id", learningObjectiveId)

  if (readCriteriaError) {
    console.error("[v0] Failed to read success criteria:", readCriteriaError)
    return LearningObjectiveReturnValue.parse({ data: null, error: readCriteriaError.message })
  }

  const existingIds = new Set((existingCriteria ?? []).map((criterion) => criterion.success_criteria_id))
  const incomingIds = new Set(
    filteredCriteria
      .map((criterion) => criterion.success_criteria_id)
      .filter((id): id is string => Boolean(id)),
  )

  const idsToDelete = Array.from(existingIds).filter((id) => !incomingIds.has(id))

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("success_criteria")
      .delete()
      .in("success_criteria_id", idsToDelete)

    if (deleteError) {
      console.error("[v0] Failed to delete removed success criteria:", deleteError)
      return LearningObjectiveReturnValue.parse({ data: null, error: deleteError.message })
    }
  }

  const updates = filteredCriteria.filter((criterion) => criterion.success_criteria_id)
  for (const criterion of updates) {
    const { error: updateError } = await supabase
      .from("success_criteria")
      .update({
        description: criterion.description,
        level: criterion.level,
        order_index: criterion.order_index,
        active: criterion.active,
      })
      .eq("success_criteria_id", criterion.success_criteria_id)

    if (updateError) {
      console.error("[v0] Failed to update success criterion:", updateError)
      return LearningObjectiveReturnValue.parse({ data: null, error: updateError.message })
    }

    const existingUnits = new Set(
      (existingCriteria ?? [])
        .find((row) => row.success_criteria_id === criterion.success_criteria_id)?.success_criteria_units?.map((entry) => entry.unit_id) ?? [],
    )
    const incomingUnits = new Set(criterion.unit_ids ?? [])

    const unitsToRemove = Array.from(existingUnits).filter((unitId) => !incomingUnits.has(unitId))
    const unitsToAdd = Array.from(incomingUnits).filter((unitId) => !existingUnits.has(unitId))

    if (unitsToRemove.length > 0) {
      const { error: removeError } = await supabase
        .from("success_criteria_units")
        .delete()
        .eq("success_criteria_id", criterion.success_criteria_id)
        .in("unit_id", unitsToRemove)

      if (removeError) {
        console.error("[v0] Failed to remove success criteria units:", removeError)
        return LearningObjectiveReturnValue.parse({ data: null, error: removeError.message })
      }
    }

    if (unitsToAdd.length > 0) {
      const { error: addError } = await supabase
        .from("success_criteria_units")
        .insert(
          unitsToAdd.map((unitId) => ({
            success_criteria_id: criterion.success_criteria_id!,
            unit_id: unitId,
          })),
        )

      if (addError) {
        console.error("[v0] Failed to add success criteria units:", addError)
        return LearningObjectiveReturnValue.parse({ data: null, error: addError.message })
      }
    }
  }

  const inserts = filteredCriteria.filter((criterion) => !criterion.success_criteria_id)
  if (inserts.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from("success_criteria")
      .insert(
        inserts.map((criterion) => ({
          learning_objective_id: learningObjectiveId,
          description: criterion.description,
          level: criterion.level,
          order_index: criterion.order_index,
          active: criterion.active,
        })),
      )
      .select("success_criteria_id")

    if (insertError) {
      console.error("[v0] Failed to insert new success criterion:", insertError)
      return LearningObjectiveReturnValue.parse({ data: null, error: insertError.message })
    }

    const inserted = insertedRows ?? []
    for (let index = 0; index < inserted.length; index++) {
      const row = inserted[index]
      const payload = inserts[index]
      if (!payload) continue

      const units = payload.unit_ids ?? []
      if (units.length > 0) {
        const { error: unitInsertError } = await supabase
          .from("success_criteria_units")
          .insert(
            units.map((unitId) => ({
              success_criteria_id: row.success_criteria_id,
              unit_id: unitId,
            })),
          )

        if (unitInsertError) {
          console.error("[v0] Failed to insert success criteria units:", unitInsertError)
          return LearningObjectiveReturnValue.parse({ data: null, error: unitInsertError.message })
        }
      }
    }
  }

  const finalObjective = await readSingleLearningObjective(learningObjectiveId)

  revalidatePath(`/units/${unitId}`)
  return finalObjective
}

export async function deleteLearningObjectiveAction(learningObjectiveId: string, unitId: string) {
  console.log("[v0] Server action started for learning objective deletion:", { learningObjectiveId })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("learning_objectives")
    .delete()
    .eq("learning_objective_id", learningObjectiveId)

  if (error) {
    console.error("[v0] Failed to delete learning objective:", error)
    return { success: false, error: error.message }
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

  const supabase = await createSupabaseServerClient()

  for (const update of updates) {
    const { error } = await supabase
      .from("learning_objectives")
      .update({ order_index: update.orderBy })
      .eq("learning_objective_id", update.learningObjectiveId)

    if (error) {
      console.error("[v0] Failed to reorder learning objective:", error)
      return { success: false, error: error.message }
    }
  }

  revalidatePath(`/units/${unitId}`)
  return { success: true }
}

async function readSingleLearningObjective(learningObjectiveId: string) {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("learning_objectives")
    .select(
      `learning_objective_id,
        assessment_objective_id,
        title,
        order_index,
        active,
        spec_ref,
        assessment_objective:assessment_objectives(
          assessment_objective_id,
          curriculum_id,
          unit_id,
          code,
          title,
          order_index
        ),
        success_criteria(*)
      `,
    )
    .eq("learning_objective_id", learningObjectiveId)
    .maybeSingle()

  if (error) {
    console.error("[v0] Failed to read learning objective:", error)
    return LearningObjectiveReturnValue.parse({ data: null, error: error.message })
  }

  if (!data) {
    return LearningObjectiveReturnValue.parse({ data: null, error: null })
  }

  const assessmentObjective = Array.isArray(data.assessment_objective)
    ? data.assessment_objective[0] ?? null
    : data.assessment_objective ?? null

  const base = data as Record<string, any>

  const normalized: Record<string, any> = {
    ...base,
    assessment_objective: assessmentObjective,
    assessment_objective_code:
      base.assessment_objective_code ?? assessmentObjective?.code ?? null,
    assessment_objective_title:
      base.assessment_objective_title ?? assessmentObjective?.title ?? null,
    assessment_objective_order_index:
      base.assessment_objective_order_index ?? assessmentObjective?.order_index ?? null,
    assessment_objective_curriculum_id:
      base.assessment_objective_curriculum_id ?? assessmentObjective?.curriculum_id ?? null,
    assessment_objective_unit_id:
      base.assessment_objective_unit_id ?? assessmentObjective?.unit_id ?? null,
  }

  return LearningObjectiveReturnValue.parse({ data: normalized, error: null })
}
