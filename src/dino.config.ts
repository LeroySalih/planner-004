export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "long-text-question",
  "upload-file",
  "feedback",
])

export const NON_SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "text",
  "text-question",
  "display-image",
  "file-download",
  "show-video",
  "voice",
])

const SCORABLE_ACTIVITY_TYPE_SET = new Set(SCORABLE_ACTIVITY_TYPES)
const NON_SCORABLE_ACTIVITY_TYPE_SET = new Set(NON_SCORABLE_ACTIVITY_TYPES)

export function normalizeActivityType(type: string | null | undefined): string {
  return (type ?? "").trim().toLowerCase()
}

export function isScorableActivityType(type: string | null | undefined): boolean {
  const normalized = normalizeActivityType(type)
  if (!normalized) return false
  if (SCORABLE_ACTIVITY_TYPE_SET.has(normalized)) return true
  if (NON_SCORABLE_ACTIVITY_TYPE_SET.has(normalized)) return false
  return false
}

export function isKnownNonScorableActivityType(type: string | null | undefined): boolean {
  const normalized = normalizeActivityType(type)
  if (!normalized) return false
  return NON_SCORABLE_ACTIVITY_TYPE_SET.has(normalized)
}

export function assertSummativeEligibleActivityType(type: string | null | undefined) {
  if (!isScorableActivityType(type)) {
    throw new Error("Only scorable activity types may be marked as assessment.")
  }
}
