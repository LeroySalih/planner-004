import type { AssignmentResultCell } from "@/types"

export type ScoreStatus = AssignmentResultCell["status"]

export type ScoreBand = "high" | "mid" | "low" | "pending"

export const SCORE_BANDS: Record<ScoreBand, { min: number; max: number }> = {
  high: { min: 0.7000000001, max: 1 },
  mid: { min: 0.3, max: 0.7 },
  low: { min: 0, max: 0.2999999999 },
  pending: { min: 0, max: 0 },
}

export function getScoreBand(score: number | null | undefined): ScoreBand {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "pending"
  }
  if (score > 0.7) {
    return "high"
  }
  if (score < 0.3) {
    return "low"
  }
  return "mid"
}

export function resolveScoreTone(score: number | null | undefined, status: ScoreStatus): string {
  if (status === "missing" || typeof score !== "number" || Number.isNaN(score)) {
    return "bg-muted text-muted-foreground"
  }

  const band = getScoreBand(score)

  if (band === "high") {
    return "bg-emerald-500/80 text-emerald-950"
  }

  if (band === "low") {
    return "bg-rose-500/80 text-rose-50"
  }

  return "bg-amber-400/80 text-amber-950"
}
