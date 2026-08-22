export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "upload-spreadsheet",
  "upload-code",
  "upload-worksheet",
  "mark-worksheet",
  "feedback",
  "sketch-render",
  "do-flashcards",
  "matcher",
  "group-items",
  "voice",
  "sequence",
]);

// Activity types scored deterministically in-app from a single right/wrong
// outcome — no model call is involved. Their max_marks is capped at 1 however
// many success criteria they carry: a right/wrong activity is worth one mark.
// The criteria still receive per-SC marks (the activity's own result is
// propagated to each) so curriculum coverage reporting works, but attaching
// more criteria must not inflate the activity's weight in an aggregate.
export const DETERMINISTIC_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "matcher",
  "sequence",
  "group-items",
  "do-flashcards",
]);

export function isDeterministicActivityType(type: string | null | undefined): boolean {
  return typeof type === "string" && DETERMINISTIC_ACTIVITY_TYPES.includes(type);
}

// Image generation is mothballed.
//
// The only models that generate images are Google's, and
// generativelanguage.googleapis.com is geo-blocked from Saudi Arabia, where
// this app is hosted; Claude cannot generate images at all. Rather than delete
// working code we expect to revive, this flag hides the capability at the two
// points where it can be *introduced* — the lesson activity picker and the AI
// chat's image proposals.
//
// Deliberately NOT a kill switch: existing sketch-render activities still
// render, still accept pupil work, and still appear in reports. Flip to true to
// revive, and nothing else needs changing.
export const IMAGE_GENERATION_ENABLED = false;

/** Activity types that cannot function without image generation. */
export const IMAGE_GENERATION_ACTIVITY_TYPES = Object.freeze(["sketch-render"]);

/**
 * True when a type depends on image generation and that is currently mothballed.
 * Callers use this to hide a type from creation surfaces — never to hide or
 * disable activities that already exist.
 */
export function isMothballedActivityType(type: string | null | undefined): boolean {
  if (IMAGE_GENERATION_ENABLED) return false;
  return IMAGE_GENERATION_ACTIVITY_TYPES.includes(normalizeActivityType(type));
}

// Activity types marked by a model rather than deterministically in-app. These
// are exactly the types listed in the AI branch of
// compute_submission_base_score (see 086-upload-code-activity-score.sql) — keep
// the two in step, or a type will be marked but read back as unscored.
// Used by /admin/ai-models to decide which types can be routed to a model.
export const AI_MARKED_ACTIVITY_TYPES = Object.freeze([
  "short-text-question",
  "upload-code",
  "upload-worksheet",
  "mark-worksheet",
  "upload-spreadsheet",
]);

export function isAiMarkedActivityType(type: string | null | undefined): boolean {
  const normalized = normalizeActivityType(type);
  return normalized.length > 0 && AI_MARKED_ACTIVITY_TYPES.includes(normalized);
}

export const NON_SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "text",
  "display-image",
  "display-webpage",
  "display-flashcards",
  "file-download",
  "show-video",
  "share-my-work",
  "review-others-work",
  "display-section",
]);

// Experimental activity types are hidden from lesson designers unless the
// teacher profile has "Show Experimental Activities" enabled. This is
// orthogonal to scorability — an experimental type may be scorable or not.
export const EXPERIMENTAL_ACTIVITY_TYPES = Object.freeze([
  "long-text-question",
  "display-flashcards",
  "do-flashcards",
  "feedback",
  "text-question",
  "sketch-render",
  "share-my-work",
  "review-others-work",
]);

const SCORABLE_ACTIVITY_TYPE_SET = new Set(SCORABLE_ACTIVITY_TYPES);
const NON_SCORABLE_ACTIVITY_TYPE_SET = new Set(NON_SCORABLE_ACTIVITY_TYPES);
const EXPERIMENTAL_ACTIVITY_TYPE_SET = new Set(EXPERIMENTAL_ACTIVITY_TYPES);

export function isExperimentalActivityType(
  type: string | null | undefined,
): boolean {
  const normalized = normalizeActivityType(type);
  if (!normalized) return false;
  return EXPERIMENTAL_ACTIVITY_TYPE_SET.has(normalized);
}

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

export const MARK_STATUSES = Object.freeze([
  "waiting",
  "reading",
  "marking",
  "marked",
  "reading-error",
  "marking-error",
] as const);

export type MarkStatus = (typeof MARK_STATUSES)[number];

const MARK_STATUS_SET: ReadonlySet<string> = new Set(MARK_STATUSES);

export function isMarkStatus(value: unknown): value is MarkStatus {
  return typeof value === "string" && MARK_STATUS_SET.has(value);
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
