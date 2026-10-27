import { isScorableActivityType } from "@/dino.config"

/**
 * The progress rule: an activity counts towards progress only when it is
 * scorable and has at least one success criterion linked. One without
 * criteria drops out of every figure, its marks and its max marks alike.
 *
 * TypeScript twin of `activity_counts_for_progress` in
 * src/migrations/129-criteria-marking.sql. Keep the two in step.
 */
export function countsForProgress(type: string | null | undefined, criteriaCount: number): boolean {
  return isScorableActivityType(type) && criteriaCount > 0
}
