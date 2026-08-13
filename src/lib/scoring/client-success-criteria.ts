import type { AssignmentResultCriterionScores } from "@/types"

export type SuccessCriteriaScoreRecord = AssignmentResultCriterionScores

interface NormaliseOptions {
  successCriteriaIds: string[]
  existingScores?: SuccessCriteriaScoreRecord | null | undefined
  fillValue?: number | null
}

export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0
  if (score < 0) return 0
  if (score > 1) return 1
  return score
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
 * Marks a single criterion contributes: 1 for binary, n for a levelled criterion
 * with n descriptors. A levelled criterion scores 0..n, so it has n+1 outcomes
 * and binary is simply the n=1 case.
 */
export function criterionAvailableMarks(
  scType: "binary" | "levelled",
  descriptorCount: number,
): number {
  return scType === "levelled" ? Math.max(1, descriptorCount) : 1
}

/**
 * Weighted total across a submission's criteria. A 3-level criterion counts
 * three times a binary one — this is what makes it a weighted sum rather than
 * the unweighted mean taken by computeAverageSuccessCriteriaScore.
 *
 * Returns the normalised 0-1 value expected by compute_submission_base_score,
 * alongside the raw marks for display. Null when there are no criteria.
 */
export function computeScAggregate(
  marks: Array<{ awarded: number; available: number }>,
): { normalised: number; awarded: number; available: number } | null {
  if (marks.length === 0) return null

  let awarded = 0
  let available = 0
  for (const mark of marks) {
    awarded += mark.awarded
    available += mark.available
  }

  if (available <= 0) return null

  return { normalised: clampScore(awarded / available), awarded, available }
}

/**
 * Computes the average score for a success-criteria record. Null/undefined values count as zero.
 * Returns null if there are no criteria in the record.
 *
 * NOTE: this is an UNWEIGHTED mean over normalised 0-1 values. It predates
 * levelled criteria and must not be used to total per-criterion marks — use
 * computeScAggregate for that. Retained for the legacy score-map paths.
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
