export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "feedback",
  "sketch-render",
  "do-flashcards",
  "matcher",
]);

export const NON_SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "text",
  "display-image",
  "display-flashcards",
  "file-download",
  "show-video",
  "voice",
  "share-my-work",
  "review-others-work",
  "display-section",
]);

const SCORABLE_ACTIVITY_TYPE_SET = new Set(SCORABLE_ACTIVITY_TYPES);
const NON_SCORABLE_ACTIVITY_TYPE_SET = new Set(NON_SCORABLE_ACTIVITY_TYPES);

export function normalizeActivityType(type: string | null | undefined): string {
  return (type ?? "").trim().toLowerCase();
}

export function isScorableActivityType(
  type: string | null | undefined,
): boolean {
  const normalized = normalizeActivityType(type);
  if (!normalized) return false;
  if (SCORABLE_ACTIVITY_TYPE_SET.has(normalized)) return true;
  if (NON_SCORABLE_ACTIVITY_TYPE_SET.has(normalized)) return false;
  return false;
}

export function isKnownNonScorableActivityType(
  type: string | null | undefined,
): boolean {
  const normalized = normalizeActivityType(type);
  if (!normalized) return false;
  return NON_SCORABLE_ACTIVITY_TYPE_SET.has(normalized);
}

export function assertSummativeEligibleActivityType(
  type: string | null | undefined,
) {
  if (!isScorableActivityType(type)) {
    throw new Error(
      "Only scorable activity types may be marked as assessment.",
    );
  }
}

// Activity types shown to unauthenticated public visitors.
// Excludes interactive/pupil-specific types (file-download, share-my-work,
// review-others-work, voice) even though they are non-scorable.
export const PUBLIC_ACTIVITY_TYPES = [
  "text",
  "display-image",
  "show-video",
  "display-section",
  "display-flashcards",
] as const

export type PublicActivityType = (typeof PUBLIC_ACTIVITY_TYPES)[number]

export function isPublicActivityType(type: string): type is PublicActivityType {
  return (PUBLIC_ACTIVITY_TYPES as readonly string[]).includes(type)
}
