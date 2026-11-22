import { isAssessmentPaperType } from "@/dino.config"

// Which model marks one question of a question-marked activity
// (activity_questions.marking_model, migration 148). Null = the activity's
// route in ai_model_routes.
//
// The rule: a question whose marker is sent pictures must be marked by a
// high-resolution vision model, because image comparison is where a
// standard-tier model loses marks. Text-only questions (a presentation or
// database report, typed text, a reference file) may name a cheaper one.
//
// Pure: no database, no server-only, so the lesson editor checks a question
// as the teacher edits it and setAssessmentQuestions checks it again.

/** The catalogue fields this rule needs; MODEL_CATALOGUE entries fit it. */
export interface QuestionModelOption {
  provider: string
  model: string
  label: string
  kind: "text" | "image"
  visionTier: "high" | "standard"
  available: boolean
}

/** One evidence source, as stored: only what decides whether it sends pictures. */
type EvidenceLike = { source?: unknown; want?: unknown }

/**
 * Why the marker of this question is sent pictures, or null when it is sent
 * text only. Mirrors what the markers attach:
 *   - assessment paper (assessment-paper/marking.ts): the answer's page images, always;
 *   - practical (powerpoint-assessment/marking.ts): `slide_images` (rendered
 *     slides), `file` (a PDF attached whole) and `evidence_section` unless
 *     `want` is 'text' (its screenshots; the marker attaches them for any
 *     other `want`, absent included). `presentation`, `database` and
 *     `reference_file` are text in the prompt.
 */
export function questionImageReason(type: string | null | undefined, evidence: readonly unknown[] | null | undefined): string | null {
  if (isAssessmentPaperType(type)) return "is marked from the pupil's script pages"
  for (const raw of evidence ?? []) {
    const source = (raw ?? {}) as EvidenceLike
    if (source.source === "slide_images") return "uses slide pictures"
    if (source.source === "file") return "attaches a PDF"
    if (source.source === "evidence_section" && source.want !== "text") return "uses screenshots"
  }
  return null
}

/** True when the marker of this question is sent pictures (see questionImageReason). */
export function questionSendsImages(type: string | null | undefined, evidence: readonly unknown[] | null | undefined): boolean {
  return questionImageReason(type, evidence) !== null
}

/** The models a question may name: available text models. */
export function selectableQuestionModels<T extends QuestionModelOption>(catalogue: readonly T[]): T[] {
  return catalogue.filter((entry) => entry.kind === "text" && entry.available)
}

/** The models a question that sends pictures may name. */
export function highVisionQuestionModels<T extends QuestionModelOption>(catalogue: readonly T[]): T[] {
  return selectableQuestionModels(catalogue).filter((entry) => entry.visionTier === "high")
}

function listLabels(entries: readonly QuestionModelOption[]): string {
  const labels = entries.map((entry) => entry.label)
  if (labels.length <= 1) return labels.join("")
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`
}

/** The refusal for a standard-tier model on a question that sends pictures. */
export function imageModelMessage(label: string, reason: string, catalogue: readonly QuestionModelOption[]): string {
  return `Question "${label}" ${reason}, so it must be marked by a high-resolution vision model (${listLabels(highVisionQuestionModels(catalogue))}).`
}

/**
 * What is wrong with a question's marking model, or null. `model` null is
 * the activity default and always fine. An unknown or unavailable model is
 * refused; a standard-tier model is refused when the question sends pictures.
 */
export function questionModelProblem(input: {
  label: string
  type: string | null | undefined
  evidence: readonly unknown[] | null | undefined
  model: string | null
  catalogue: readonly QuestionModelOption[]
}): string | null {
  if (input.model === null) return null
  const entry = input.catalogue.find((e) => e.model === input.model)
  if (!entry || entry.kind !== "text") {
    return `Question "${input.label}" names an unknown marking model: ${JSON.stringify(input.model)}. Choose one of ${selectableQuestionModels(input.catalogue).map((e) => e.model).join(", ")}, or none for the activity default.`
  }
  if (!entry.available) {
    return `Question "${input.label}" names ${entry.label}, which cannot be used for marking.`
  }
  const reason = questionImageReason(input.type, input.evidence)
  if (reason !== null && entry.visionTier !== "high") return imageModelMessage(input.label, reason, input.catalogue)
  return null
}
