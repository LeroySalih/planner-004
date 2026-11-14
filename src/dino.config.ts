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
  "assessment-paper",
  "powerpoint-assessment",
]);

// Activity types marked question by question, each question splitting its
// marks across its success criteria. Their totals, max_marks and
// submission_sc_marks rows are derived from the question marks by
// src/lib/assessment-paper/store.ts, so the per-criterion machinery
// (refresh_criterion_marks, the activity_success_criteria trigger, teacher
// criterion marks, whole-activity overrides) must leave them alone.
// Mirrored in SQL by is_question_marked_activity_type (migrations 132, 143).
//
// The question machinery is shared, but each type hands its work in its own
// way: an assessment-paper as a scanned script (front sheet, markable pages),
// a powerpoint-assessment as named files (presentation, PDFs, evidence
// document). Anything that touches scripts, front sheets or pages must ask
// isAssessmentPaperType, not isQuestionMarkedActivityType.
export const QUESTION_MARKED_ACTIVITY_TYPES = Object.freeze(["assessment-paper", "powerpoint-assessment"]);

export function isQuestionMarkedActivityType(type: string | null | undefined): boolean {
  return QUESTION_MARKED_ACTIVITY_TYPES.includes(normalizeActivityType(type));
}

/** An assessment paper: a scanned script read page by page. */
export function isAssessmentPaperType(type: string | null | undefined): boolean {
  return normalizeActivityType(type) === "assessment-paper";
}

/** A PowerPoint assessment: pupils hand in named files, read without a model, then marked per question. */
export function isPowerPointAssessmentType(type: string | null | undefined): boolean {
  return normalizeActivityType(type) === "powerpoint-assessment";
}

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

// Stand-alone assessment papers (/assessments, /my-assessments and the
// *_assessment_paper* MCP tools) are retired in favour of the assessment-paper
// lesson activity. Off hides the menu links and unregisters the MCP tools; the
// pages, code and tables are kept so it can be turned back on. Unrelated to the
// assessment-paper activity, which this flag does not touch.
export const ASSESSMENT_PAPERS_ENABLED = false;

/** Activity types that cannot function without image generation. */
export const IMAGE_GENERATION_ACTIVITY_TYPES = Object.freeze(["sketch-render"]);

// Defunct types kept only so existing activities (and pupils' work on them)
// still display and score. No surface may create a new one: the lesson
// activity picker, the lesson sidebar, MCP and the server actions all refuse.
export const LEGACY_ACTIVITY_TYPES = Object.freeze(["do-flashcards"]);

export function isLegacyActivityType(type: string | null | undefined): boolean {
  return LEGACY_ACTIVITY_TYPES.includes(normalizeActivityType(type));
}

export function legacyActivityTypeMessage(type: string): string {
  return `"${type}" is a legacy activity type and can no longer be created. Existing ${type} activities still work.`;
}

/**
 * True when a new activity of this type must not be created: a legacy type, or
 * one that depends on image generation while that is mothballed. Callers use
 * this to hide a type from creation surfaces — never to hide or disable
 * activities that already exist.
 */
export function isMothballedActivityType(type: string | null | undefined): boolean {
  if (isLegacyActivityType(type)) return true;
  if (IMAGE_GENERATION_ENABLED) return false;
  return IMAGE_GENERATION_ACTIVITY_TYPES.includes(normalizeActivityType(type));
}

// Activity types marked by a model rather than deterministically in-app. These
// are the types listed in the AI branch of compute_submission_base_score (see
// 086-upload-code-activity-score.sql) — keep the two in step, or a type will
// be marked but read back as unscored.
// Used by /admin/ai-models to decide which types can be routed to a model.
//
// Two exceptions are not in that SQL branch, and need not be, because their
// score is written to `score` as well as `ai_model_score`:
// - assessment-paper: recomputeAssessmentSubmission writes both.
// - powerpoint-assessment: likewise. It is listed so /admin/ai-models can route
//   its per-question mark (migration 143); its files are read in-app, with no
//   model, so only the mark uses the route.
// - upload-file: per-criterion marking writes both (aggregate-sc-marks.ts).
//   It is AI-marked only when the activity's "Mark with AI" switch is on
//   (body_data.aiMarking), so anything that acts on an activity rather than
//   listing the types must ask isAiMarkedActivity, not isAiMarkedActivityType.
export const AI_MARKED_ACTIVITY_TYPES = Object.freeze([
  "short-text-question",
  "upload-code",
  "upload-worksheet",
  "mark-worksheet",
  "upload-spreadsheet",
  "assessment-paper",
  "powerpoint-assessment",
  "upload-file",
]);

/** Types that are AI-marked only when their body_data turns it on. */
const OPT_IN_AI_MARKED_ACTIVITY_TYPES = Object.freeze(["upload-file"]);

export function isAiMarkedActivityType(type: string | null | undefined): boolean {
  const normalized = normalizeActivityType(type);
  return normalized.length > 0 && AI_MARKED_ACTIVITY_TYPES.includes(normalized);
}

/** Whether this activity is marked by a model: its type is, and an opt-in type has it turned on. */
export function isAiMarkedActivity(type: string | null | undefined, bodyData: unknown): boolean {
  if (!isAiMarkedActivityType(type)) return false;
  if (!OPT_IN_AI_MARKED_ACTIVITY_TYPES.includes(normalizeActivityType(type))) return true;
  return typeof bodyData === "object" && bodyData !== null && (bodyData as { aiMarking?: unknown }).aiMarking === true;
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
