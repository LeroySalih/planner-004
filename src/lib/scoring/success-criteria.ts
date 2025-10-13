import type { SupabaseClient } from "@supabase/supabase-js"

import type { AssignmentResultCriterionScores } from "@/types"

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

export async function fetchActivitySuccessCriteriaIds(
  supabase: SupabaseClient,
  activityId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("activity_success_criteria")
    .select("success_criteria_id")
    .eq("activity_id", activityId)

  if (error) {
    console.error("[scoring] Failed to load activity success criteria:", error)
    return []
  }

  return (data ?? [])
    .map((row) => (typeof row?.success_criteria_id === "string" ? row.success_criteria_id : null))
    .filter((id): id is string => Boolean(id && id.trim().length > 0))
}
