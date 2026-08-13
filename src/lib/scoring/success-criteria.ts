import type { AssignmentResultCriterionScores } from "@/types"
import { query } from "@/lib/db"
import {
  computeScAggregate,
  criterionAvailableMarks,
} from "@/lib/scoring/client-success-criteria"

export { computeScAggregate, criterionAvailableMarks }

export type SuccessCriteriaScoreRecord = AssignmentResultCriterionScores

interface NormaliseOptions {
  successCriteriaIds: string[]
  existingScores?: SuccessCriteriaScoreRecord | null | undefined
  fillValue?: number | null
}

/**
 * Ensures we have an explicit entry for every success criterion linked to the activity.
 * Missing entries are initialised with the provided `fillValue` (default 0).
 */
export function normaliseSuccessCriteriaScores({
  successCriteriaIds,
  existingScores,
  fillValue = 0,
}: NormaliseOptions): SuccessCriteriaScoreRecord {
  const result: SuccessCriteriaScoreRecord = {}
  const source = existingScores ?? {}

  successCriteriaIds.forEach((id) => {
    if (Object.prototype.hasOwnProperty.call(source, id)) {
      const value = source[id]
      result[id] = typeof value === "number" && Number.isFinite(value) ? clampScore(value) : fillValue ?? 0
    } else {
      result[id] = fillValue ?? 0
    }
  })

  return result
}

/**
 * Computes the average score for a success-criteria record. Null/undefined values count as zero.
 * Returns null if there are no criteria in the record.
 */
export function computeAverageSuccessCriteriaScore(scores: SuccessCriteriaScoreRecord): number | null {
  const entries = Object.entries(scores)
  if (entries.length === 0) {
    return null
  }

  const { total, count } = entries.reduce(
    (acc, [, value]) => {
      const numeric = typeof value === "number" && Number.isFinite(value) ? clampScore(value) : 0
      acc.total += numeric
      acc.count += 1
      return acc
    },
    { total: 0, count: 0 },
  )

  if (count === 0) {
    return null
  }

  return total / count
}

export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0
  if (score < 0) return 0
  if (score > 1) return 1
  return score
}

export type ScType = "binary" | "levelled"

export interface ActivityCriterion {
  successCriteriaId: string
  description: string
  scType: ScType
  /** Marks this criterion contributes: 1 for binary, n for levelled. */
  available: number
  /** Ascending descriptors, lowest first. Empty for binary criteria. */
  descriptors: string[]
}

/**
 * Loads an activity's criteria with the detail the marking flow needs: type,
 * available marks and the ascending descriptors sent to the model.
 */
export async function fetchActivityCriteria(activityId: string): Promise<ActivityCriterion[]> {
  try {
    const { rows } = await query<{
      success_criteria_id: string
      description: string
      sc_type: string
      descriptors: string[] | null
    }>(
      `select sc.success_criteria_id,
              sc.description,
              sc.sc_type,
              coalesce(
                array(
                  select d.descriptor
                  from success_criteria_descriptors d
                  where d.success_criteria_id = sc.success_criteria_id
                  order by d.level_index
                ),
                '{}'
              ) as descriptors
       from activity_success_criteria acs
       join success_criteria sc on sc.success_criteria_id = acs.success_criteria_id
       where acs.activity_id = $1
       order by sc.order_index, sc.success_criteria_id`,
      [activityId],
    )

    return (rows ?? []).map((row) => {
      const scType: ScType = row.sc_type === "levelled" ? "levelled" : "binary"
      const descriptors = row.descriptors ?? []
      return {
        successCriteriaId: row.success_criteria_id,
        description: row.description,
        scType,
        available: criterionAvailableMarks(scType, descriptors.length),
        descriptors,
      }
    })
  } catch (error) {
    console.error("[scoring] Failed to load activity criteria:", error)
    return []
  }
}

/**
 * Loads one criterion with the detail a marking call needs.
 */
export async function fetchCriterionForMarking(
  successCriteriaId: string,
): Promise<ActivityCriterion | null> {
  const { rows } = await query<{
    success_criteria_id: string
    description: string
    sc_type: string
    descriptors: string[] | null
  }>(
    `select sc.success_criteria_id,
            sc.description,
            sc.sc_type,
            coalesce(
              array(
                select d.descriptor
                from success_criteria_descriptors d
                where d.success_criteria_id = sc.success_criteria_id
                order by d.level_index
              ),
              '{}'
            ) as descriptors
     from success_criteria sc
     where sc.success_criteria_id = $1
     limit 1`,
    [successCriteriaId],
  )

  const row = rows[0]
  if (!row) return null

  const scType: ScType = row.sc_type === "levelled" ? "levelled" : "binary"
  const descriptors = row.descriptors ?? []

  return {
    successCriteriaId: row.success_criteria_id,
    description: row.description,
    scType,
    available: criterionAvailableMarks(scType, descriptors.length),
    descriptors,
  }
}

/**
 * Loads a submission's per-criterion marks from the authoritative store.
 */
export async function fetchSubmissionScMarks(
  submissionId: string,
): Promise<Array<{ successCriteriaId: string; awarded: number; available: number; feedback: string | null; provenance: string }>> {
  const { rows } = await query<{
    success_criteria_id: string
    awarded: number
    available: number
    feedback: string | null
    provenance: string
  }>(
    `select success_criteria_id, awarded, available, feedback, provenance
     from submission_sc_marks
     where submission_id = $1`,
    [submissionId],
  )

  return (rows ?? []).map((row) => ({
    successCriteriaId: row.success_criteria_id,
    awarded: Number(row.awarded),
    available: Number(row.available),
    feedback: row.feedback,
    provenance: row.provenance,
  }))
}

export async function fetchActivitySuccessCriteriaIds(activityId: string): Promise<string[]> {
  try {
    const { rows } = await query(
      "select success_criteria_id from activity_success_criteria where activity_id = $1",
      [activityId],
    )

    return (rows ?? [])
      .map((row) => (typeof row?.success_criteria_id === "string" ? row.success_criteria_id : null))
      .filter((id): id is string => Boolean(id && id.trim().length > 0))
  } catch (error) {
    console.error("[scoring] Failed to load activity success criteria:", error)
    return []
  }
}
